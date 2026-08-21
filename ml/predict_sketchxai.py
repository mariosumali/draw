#!/usr/bin/env python3
"""Run one SketchXAI QuickDraw prediction from JSON strokes on stdin."""

from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch

from sketchxai_model import ViTForSketchClassification


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_ID = "WinKawaks/SketchXAI-Base-QuickDraw345"
DEFAULT_CLASSES_PATH = PROJECT_ROOT / "public/models/quickdraw-tflite/classes.json"
MAX_STROKES = 196


def main() -> None:
    payload = json.load(sys.stdin)
    if payload.get("warm"):
        load_model()
        print(json.dumps({"ready": True}))
        return

    strokes = payload.get("strokes")
    width = float(payload.get("width") or 720)
    height = float(payload.get("height") or 520)
    top_k = int(payload.get("topK") or 5)
    if not isinstance(strokes, list) or not strokes:
        print(json.dumps({"predictions": []}))
        return

    points3 = strokes_to_points3(strokes, width, height)
    if points3 is None:
        print(json.dumps({"predictions": []}))
        return

    model, labels, device = load_model()
    point_values, position_values, stroke_number = collate_single(points3)

    with torch.no_grad():
        logits, *_ = model(point_values.to(device), position_values.to(device), stroke_number)
        probabilities = torch.softmax(logits[0], dim=-1).detach().cpu().numpy()

    indices = np.argsort(probabilities)[::-1][:top_k]
    predictions = [
        {"label": labels[int(index)], "confidence": float(probabilities[int(index)])}
        for index in indices
    ]
    print(json.dumps({"predictions": predictions}))


@lru_cache(maxsize=1)
def load_model():
    device = resolve_device()
    labels = sorted(
        json.loads(DEFAULT_CLASSES_PATH.read_text(encoding="utf-8")),
        key=lambda class_name: class_name.lower(),
    )
    opt = {
        "bs": 1,
        "max_stroke": MAX_STROKES,
        "shape_emb": "sum",
        "shape_extractor": "lstm",
        "shape_extractor_layer": 2,
    }
    model = ViTForSketchClassification.from_pretrained(
        DEFAULT_MODEL_ID,
        opt,
        labels_number=len(labels),
        use_mask_token=False,
    )
    model.to(device)
    model.eval()
    return model, labels, device


def resolve_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def strokes_to_points3(strokes: list[object], width: float, height: float) -> np.ndarray | None:
    normalized_strokes: list[list[tuple[float, float]]] = []
    all_points: list[tuple[float, float]] = []

    for stroke in strokes:
        if not isinstance(stroke, list):
            continue
        next_stroke: list[tuple[float, float]] = []
        for point in stroke:
            if not isinstance(point, dict):
                continue
            try:
                x = float(point["x"]) / width
                y = float(point["y"]) / height
            except (KeyError, TypeError, ValueError):
                continue
            next_stroke.append((x, y))
            all_points.append((x, y))
        if next_stroke:
            normalized_strokes.append(next_stroke)

    if not all_points:
        return None

    normalized_points = normalize_points(np.asarray(all_points, dtype=np.float32))
    if normalized_points is None:
        return None

    rows: list[list[float]] = []
    offset = 0
    for stroke in normalized_strokes[:MAX_STROKES]:
        for point_index, _point in enumerate(stroke):
            x, y = normalized_points[offset + point_index]
            pen_end = 1.0 if point_index == len(stroke) - 1 else 0.0
            rows.append([float(x), float(y), pen_end])
        offset += len(stroke)

    if len(rows) < 2:
        return None
    return np.asarray(rows, dtype=np.float32)


def normalize_points(points: np.ndarray, pad_thresh: float = 0.26, eps: float = 1e-8) -> np.ndarray | None:
    bbox_min = np.amin(points, axis=0)
    bbox_max = np.amax(points, axis=0)
    bbox_diag = bbox_max - bbox_min
    if float(np.dot(bbox_diag, bbox_diag)) < eps:
        return None
    bbox_max_side = float(np.amax(bbox_diag))
    normalized = (points - bbox_min) / bbox_max_side
    normalized *= 1.0 - pad_thresh
    bbox_max_new = (bbox_max - bbox_min) / bbox_max_side * (1.0 - pad_thresh)
    normalized += np.asarray([0.5 - bbox_max_new[0] * 0.5, 0.5 - bbox_max_new[1] * 0.5])
    normalized *= 2.0
    normalized -= 1.0
    return normalized.astype(np.float32)


def collate_single(points3: np.ndarray) -> tuple[torch.Tensor, torch.Tensor, list[np.ndarray]]:
    end_indices = np.where(points3[:, 2] > 0)[0]
    if end_indices.size == 0:
        points3[-1, 2] = 1
        end_indices = np.asarray([len(points3) - 1])

    stroke_lengths = end_indices + 1
    stroke_lengths[1:] = stroke_lengths[1:] - stroke_lengths[:-1]
    stroke_lengths = stroke_lengths[:MAX_STROKES]
    max_length_stroke = max(int(np.max(stroke_lengths)), 1)

    stroke4_offset_list: list[np.ndarray] = []
    position_list: list[np.ndarray] = []
    for stroke_id, stroke_end in enumerate(end_indices[:MAX_STROKES]):
        stroke_start = 0 if stroke_id == 0 else int(end_indices[stroke_id - 1]) + 1
        stroke_length = int(stroke_end) + 1 if stroke_id == 0 else int(stroke_end - end_indices[stroke_id - 1])
        stroke_length = min(stroke_length, max_length_stroke)

        cur_stroke = np.zeros((max_length_stroke, 4), np.float32)
        cur_stroke[:stroke_length, :2] = points3[stroke_start : stroke_start + stroke_length, :2]
        cur_stroke[:stroke_length, 2] = 1 - points3[stroke_start : stroke_start + stroke_length, 2]
        cur_stroke[:stroke_length, 3] = points3[stroke_start : stroke_start + stroke_length, 2]

        position_list.append(np.copy(cur_stroke[0, :2]))
        cur_stroke_offset = np.copy(cur_stroke)
        cur_stroke_offset[1:stroke_length, :2] = (
            cur_stroke[1:stroke_length, :2] - cur_stroke[: stroke_length - 1, :2]
        )
        cur_stroke_offset[0, :2] = 0
        stroke4_offset_list.append(cur_stroke_offset)

    return (
        torch.from_numpy(np.asarray(stroke4_offset_list, dtype=np.float32)),
        torch.from_numpy(np.asarray(position_list, dtype=np.float32)),
        [stroke_lengths],
    )


if __name__ == "__main__":
    main()
