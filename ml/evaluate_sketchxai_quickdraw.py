#!/usr/bin/env python3
"""Evaluate SketchXAI Hugging Face checkpoints on local QuickDraw NDJSON data."""

from __future__ import annotations

import argparse
import json
import math
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import torch

from sketchxai_model import ViTForSketchClassification
from train_quickdraw_strokes import (
    DEFAULT_ARTIFACT_DIR,
    DEFAULT_DATA_DIR,
    SPLITS,
    estimate_remaining,
    format_duration,
    log_status,
    make_split_plan,
    percent,
    read_quickdraw_classes,
    write_json,
)


DEFAULT_MODEL_ID = "WinKawaks/SketchXAI-Base-QuickDraw345"
DEFAULT_CLASSES_URL = "https://raw.githubusercontent.com/googlecreativelab/quickdraw-dataset/master/categories.txt"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    parser.add_argument("--classes-url", default=DEFAULT_CLASSES_URL)
    parser.add_argument(
        "--preserve-class-order",
        action="store_true",
        help="Use the downloaded categories order instead of SketchXAI's lowercase-sorted order.",
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--stroke-source", choices=["simplified", "raw"], default="simplified")
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--split", choices=SPLITS, default="validation")
    parser.add_argument("--samples-per-class", type=int, default=10000)
    parser.add_argument("--validation-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-stroke", type=int, default=196)
    parser.add_argument("--max-classes", type=int, default=0)
    parser.add_argument("--max-examples-per-class", type=int, default=0)
    parser.add_argument("--include-unrecognized", action="store_true")
    parser.add_argument("--device", choices=["auto", "cpu", "mps", "cuda"], default="auto")
    parser.add_argument("--status-batches", type=int, default=25)
    parser.add_argument("--top-confusions", type=int, default=5)
    parser.add_argument("--output", type=Path, help="Output JSON report path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validate_args(args)
    classes = read_quickdraw_classes(args.classes_url)
    if not args.preserve_class_order:
        classes = sorted(classes, key=lambda class_name: class_name.lower())
    eval_classes = classes
    if args.max_classes:
        eval_classes = classes[: args.max_classes]

    device = resolve_device(args.device)
    model = load_model(args.model_id, len(classes), args.batch_size, args.max_stroke, device)
    output_path = args.output or args.artifact_dir / "sketchxai-base-validation-evaluation.json"
    total_examples = estimate_example_count(args, len(eval_classes))
    total_batches = math.ceil(total_examples / args.batch_size)

    log_status(
        "SketchXAI evaluation: "
        f"model={args.model_id}, split={args.split}, classes={len(eval_classes)}/{len(classes)}, "
        f"examples~={total_examples:,}, batch_size={args.batch_size}, device={device}, "
        f"output={output_path}."
    )
    report = evaluate(args, model, classes, eval_classes, device, total_batches)
    report["model_id"] = args.model_id
    report["split"] = args.split
    report["source"] = "googlecreativelab/quickdraw-dataset full/simplified"
    write_json(output_path, report)

    worst = sorted(
        report["per_class"].items(),
        key=lambda item: (item[1]["top3_accuracy"], item[1]["top1_accuracy"]),
    )[:10]
    log_status(
        "SketchXAI evaluation complete: "
        f"samples={report['overall']['samples']:,}, "
        f"top1={report['overall']['top1_accuracy']:.4f}, "
        f"top3={report['overall']['top3_accuracy']:.4f}, "
        f"report={output_path}."
    )
    log_status(
        "Lowest top3 classes: "
        + ", ".join(
            f"{class_name}={metrics['top3_accuracy']:.3f}"
            for class_name, metrics in worst
        )
    )


def validate_args(args: argparse.Namespace) -> None:
    if args.samples_per_class < 1:
        raise ValueError("--samples-per-class must be positive.")
    if args.batch_size < 1:
        raise ValueError("--batch-size must be positive.")
    if args.max_stroke < 1:
        raise ValueError("--max-stroke must be positive.")
    if args.max_classes < 0:
        raise ValueError("--max-classes cannot be negative.")
    if args.max_examples_per_class < 0:
        raise ValueError("--max-examples-per-class cannot be negative.")
    if args.status_batches < 0:
        raise ValueError("--status-batches cannot be negative.")


def resolve_device(requested: str) -> torch.device:
    if requested == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA requested but unavailable.")
    if requested == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS requested but unavailable.")
    return torch.device(requested)


def load_model(model_id: str, class_count: int, batch_size: int, max_stroke: int, device: torch.device):
    opt = {
        "bs": batch_size,
        "max_stroke": max_stroke,
        "shape_emb": "sum",
        "shape_extractor": "lstm",
        "shape_extractor_layer": 2,
    }
    model = ViTForSketchClassification.from_pretrained(
        model_id,
        opt,
        labels_number=class_count,
        use_mask_token=False,
    )
    model.to(device)
    model.eval()
    return model


def estimate_example_count(args: argparse.Namespace, class_count: int) -> int:
    split_plan = make_split_plan(
        args.samples_per_class,
        args.validation_ratio,
        args.test_ratio,
        args.seed,
    )
    per_class = int(np.sum(split_plan == args.split))
    if args.max_examples_per_class:
        per_class = min(per_class, args.max_examples_per_class)
    return per_class * class_count


def evaluate(
    args: argparse.Namespace,
    model: torch.nn.Module,
    classes: list[str],
    eval_classes: list[str],
    device: torch.device,
    total_batches: int,
) -> dict[str, object]:
    class_count = len(classes)
    counts = np.zeros(class_count, dtype=np.int64)
    top1_counts = np.zeros(class_count, dtype=np.int64)
    top3_counts = np.zeros(class_count, dtype=np.int64)
    confusion = np.zeros((class_count, class_count), dtype=np.int64)
    started_at = time.monotonic()
    batch_number = 0

    with torch.no_grad():
        for batch_samples in iter_batches(args, eval_classes):
            batch_number += 1
            labels = np.asarray([sample["label"] for sample in batch_samples], dtype=np.int64)
            actual_count = len(batch_samples)
            if actual_count < args.batch_size:
                batch_samples = pad_batch(batch_samples, args.batch_size)

            point_values, position_values, stroke_number = collate_batch(batch_samples, args.max_stroke)
            logits, *_ = model(
                point_values.to(device),
                position_values.to(device),
                stroke_number,
            )
            logits = logits[:actual_count].detach().cpu().numpy()
            top1 = np.argmax(logits, axis=1)
            top3 = np.argpartition(logits, -3, axis=1)[:, -3:]
            top1_correct = top1 == labels
            top3_correct = np.any(top3 == labels[:, None], axis=1)

            np.add.at(counts, labels, 1)
            np.add.at(top1_counts, labels[top1_correct], 1)
            np.add.at(top3_counts, labels[top3_correct], 1)
            np.add.at(confusion, (labels, top1), 1)

            should_report = batch_number == total_batches or (
                args.status_batches > 0 and batch_number % args.status_batches == 0
            )
            if should_report:
                elapsed = time.monotonic() - started_at
                remaining = max(0, total_batches - batch_number)
                log_status(
                    "SketchXAI evaluation progress: "
                    f"batch {batch_number:,}/{total_batches:,} ({percent(batch_number, total_batches)}); "
                    f"elapsed {format_duration(elapsed)}, "
                    f"eta {estimate_remaining(elapsed, batch_number, remaining)}."
                )

    return build_report(classes, counts, top1_counts, top3_counts, confusion, args.top_confusions)


def iter_batches(args: argparse.Namespace, classes: list[str]) -> Iterator[list[dict[str, object]]]:
    batch: list[dict[str, object]] = []
    for label, class_name in enumerate(classes):
        split_plan = make_split_plan(
            args.samples_per_class,
            args.validation_ratio,
            args.test_ratio,
            args.seed + label,
        )
        emitted_for_class = 0
        selected = 0
        path = args.data_dir / args.stroke_source / f"{class_name}.ndjson"
        with path.open("r", encoding="utf-8") as file:
            for line in file:
                if selected >= args.samples_per_class:
                    break
                payload = json.loads(line)
                if not args.include_unrecognized and payload.get("recognized") is False:
                    continue
                if split_plan[selected] != args.split:
                    selected += 1
                    continue

                points3 = drawing_to_points3(payload.get("drawing"))
                selected += 1
                if points3 is None:
                    continue
                batch.append({"points3": points3, "label": label})
                emitted_for_class += 1
                if len(batch) == args.batch_size:
                    yield batch
                    batch = []
                if args.max_examples_per_class and emitted_for_class >= args.max_examples_per_class:
                    break
    if batch:
        yield batch


def drawing_to_points3(drawing: object) -> np.ndarray | None:
    if not isinstance(drawing, list):
        return None

    strokes: list[list[tuple[float, float]]] = []
    all_points: list[tuple[float, float]] = []
    for stroke in drawing:
        if not isinstance(stroke, list) or len(stroke) < 2:
            continue
        xs, ys = stroke[0], stroke[1]
        if not isinstance(xs, list) or not isinstance(ys, list):
            continue
        points: list[tuple[float, float]] = []
        for x, y in zip(xs, ys):
            try:
                point = (float(x), float(y))
            except (TypeError, ValueError):
                continue
            points.append(point)
            all_points.append(point)
        if points:
            strokes.append(points)

    if not all_points:
        return None

    normalized = normalize_points(np.asarray(all_points, dtype=np.float32))
    if normalized is None:
        return None

    rows: list[list[float]] = []
    offset = 0
    for stroke in strokes:
        for point_index, _point in enumerate(stroke):
            x, y = normalized[offset + point_index]
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


def collate_batch(samples: list[dict[str, object]], max_stroke: int) -> tuple[torch.Tensor, torch.Tensor, list[np.ndarray]]:
    length_stroke = [np.where(sample["points3"][:, 2] > 0)[0] + 1 for sample in samples]
    max_length_stroke = 1
    for lengths in length_stroke:
        lengths[1:] = lengths[1:] - lengths[:-1]
        max_length_stroke = max(int(np.max(lengths)), max_length_stroke)

    stroke4_offset_list: list[np.ndarray] = []
    position_list: list[np.ndarray] = []
    for sample_index, sample in enumerate(samples):
        points3 = sample["points3"]
        end_indices = np.where(points3[:, 2] > 0)[0]
        for stroke_id, stroke_end in enumerate(end_indices):
            if stroke_id >= max_stroke:
                length_stroke[sample_index] = length_stroke[sample_index][:max_stroke]
                break

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
        length_stroke,
    )


def pad_batch(samples: list[dict[str, object]], batch_size: int) -> list[dict[str, object]]:
    if not samples:
        raise ValueError("Cannot pad an empty batch.")
    padded = list(samples)
    while len(padded) < batch_size:
        padded.append(samples[-1])
    return padded


def build_report(
    classes: list[str],
    counts: np.ndarray,
    top1_counts: np.ndarray,
    top3_counts: np.ndarray,
    confusion: np.ndarray,
    top_confusions: int,
) -> dict[str, object]:
    total = int(counts.sum())
    if total == 0:
        raise ValueError("No evaluation samples were processed.")

    per_class: dict[str, object] = {}
    for label, class_name in enumerate(classes):
        if counts[label] == 0:
            continue
        row = confusion[label].copy()
        row[label] = 0
        confusion_indices = np.argsort(row)[::-1][:top_confusions]
        per_class[class_name] = {
            "samples": int(counts[label]),
            "top1_accuracy": float(top1_counts[label] / counts[label]),
            "top3_accuracy": float(top3_counts[label] / counts[label]),
            "top1_confusions": [
                {
                    "label": classes[int(index)],
                    "count": int(row[index]),
                    "rate": float(row[index] / counts[label]),
                }
                for index in confusion_indices
                if row[index] > 0
            ],
        }

    return {
        "classes": classes,
        "overall": {
            "samples": total,
            "top1_accuracy": float(top1_counts.sum() / total),
            "top3_accuracy": float(top3_counts.sum() / total),
        },
        "per_class": per_class,
    }


if __name__ == "__main__":
    main()
