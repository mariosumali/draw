#!/usr/bin/env python3
"""Recover the render parameters Google used to produce `full/numpy_bitmap`.

Google publishes both the simplified strokes and a 28x28 bitmap for every drawing,
but not the code that turned one into the other. Inference has to match that render
or the recognizer sees a different distribution than it was trained on, so the
parameters are recovered empirically here.

Row N of `<class>.npy` is line N of `<class>.ndjson`, which makes this a direct fit:
render each drawing under candidate parameters and score the result against the
published bitmap. The search reports mean IoU and mean absolute error.

    python ml/reverse_engineer_bitmaps.py
    python ml/reverse_engineer_bitmaps.py --refine --samples 200

The best fit is render size 256, a 20 px margin on each side, a 12.8 px stroke and a
bilinear (triangle) downscale to 28x28, at about 0.93 mean IoU. Those numbers are
what `src/lib/quickdraw/raster.ts` implements; rerun this after changing them.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BITMAP_DIR = PROJECT_ROOT / "ml/data/numpy_bitmap"
STROKE_DIR = PROJECT_ROOT / "ml/data/strokes/simplified"

DEFAULT_CLASSES = ["cat", "airplane", "apple", "bicycle", "clock", "house", "star", "tree"]
RESAMPLERS = {
    "bilinear": Image.BILINEAR,
    "box": Image.BOX,
    "lanczos": Image.LANCZOS,
    "nearest": Image.NEAREST,
}


def load_pairs(classes: list[str], per_class: int) -> list[tuple[list, np.ndarray]]:
    """Pairs each drawing with the published bitmap of that same drawing."""
    pairs: list[tuple[list, np.ndarray]] = []
    for name in classes:
        bitmap_path = BITMAP_DIR / f"{name}.npy"
        stroke_path = STROKE_DIR / f"{name}.ndjson"
        if not bitmap_path.exists() or not stroke_path.exists():
            print(f"  skipping {name}: missing data")
            continue

        bitmaps = np.load(bitmap_path, mmap_mode="r")
        with stroke_path.open() as handle:
            for index, line in enumerate(handle):
                if index >= per_class:
                    break
                drawing = json.loads(line)["drawing"]
                pairs.append((drawing, np.asarray(bitmaps[index]).reshape(28, 28).astype(np.float32)))
    return pairs


def render(drawing: list, base: int, width: float, margin: float, resample) -> np.ndarray:
    """Fits the stroke bounding box inside `base - 2 * margin`, strokes it, downscales."""
    xs = [x for stroke in drawing for x in stroke[0]]
    ys = [y for stroke in drawing for y in stroke[1]]
    if not xs:
        return np.zeros((28, 28), np.float32)

    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    ink_width, ink_height = max_x - min_x, max_y - min_y
    span = max(ink_width, ink_height, 1)
    inner = base - 2 * margin
    scale = inner / span
    offset_x = margin + (inner - ink_width * scale) / 2 - min_x * scale
    offset_y = margin + (inner - ink_height * scale) / 2 - min_y * scale

    image = Image.new("L", (base, base), 0)
    draw = ImageDraw.Draw(image)
    line_width = max(1, int(round(width)))
    for stroke in drawing:
        points = [(x * scale + offset_x, y * scale + offset_y) for x, y in zip(stroke[0], stroke[1])]
        if len(points) == 1:
            x, y = points[0]
            draw.ellipse(
                [x - line_width / 2, y - line_width / 2, x + line_width / 2, y + line_width / 2],
                fill=255,
            )
            continue

        draw.line(points, fill=255, width=line_width, joint="curve")
        for x, y in (points[0], points[-1]):
            draw.ellipse(
                [x - line_width / 2, y - line_width / 2, x + line_width / 2, y + line_width / 2],
                fill=255,
            )

    return np.asarray(image.resize((28, 28), resample), dtype=np.float32)


def score(pairs, base: int, width: float, margin: float, resample) -> tuple[float, float]:
    ious: list[float] = []
    errors: list[float] = []
    for drawing, truth in pairs:
        rendered = render(drawing, base, width, margin, resample)
        predicted_ink = rendered > 127
        true_ink = truth > 127
        union = np.logical_or(predicted_ink, true_ink).sum()
        ious.append(float(np.logical_and(predicted_ink, true_ink).sum() / union) if union else 1.0)
        errors.append(float(np.abs(rendered - truth).mean() / 255.0))
    return float(np.mean(ious)), float(np.mean(errors))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=80, help="drawings to fit against")
    parser.add_argument("--per-class", type=int, default=24)
    parser.add_argument("--refine", action="store_true", help="search finely around the known best fit")
    parser.add_argument("--top", type=int, default=12)
    args = parser.parse_args()

    pairs = load_pairs(DEFAULT_CLASSES, args.per_class)[: args.samples]
    if not pairs:
        raise SystemExit(f"No data found. Expected stroke files in {STROKE_DIR}")
    print(f"Fitting against {len(pairs)} drawings\n")

    if args.refine:
        bases = [256]
        margins = [16, 18, 20, 22, 24]
        widths = [11, 12, 12.8, 13.5, 14, 15]
    else:
        bases = [28, 56, 112, 224, 256]
        margins = [0, 8, 14, 20, 26]
        widths = [4, 8, 12.8, 18, 24]

    results = []
    for base in bases:
        for margin in margins:
            if margin * 2 >= base:
                continue
            for width in widths:
                for name, resample in RESAMPLERS.items():
                    iou, error = score(pairs, base, width * base / 256, margin * base / 256, resample)
                    results.append((iou, -error, base, margin, round(width, 2), name))

    results.sort(reverse=True)
    print(f"{'IoU':>6} {'MAE':>7} {'base':>5} {'margin':>7} {'width':>6}  resample")
    for iou, negative_error, base, margin, width, name in results[: args.top]:
        print(f"{iou:6.4f} {-negative_error:7.4f} {base:5d} {margin:7.1f} {width:6.2f}  {name}")

    best = results[0]
    print(
        f"\nBest fit: render {best[2]}x{best[2]}, margin {best[3]}, "
        f"stroke {best[4]}, {best[5]} downscale to 28x28"
    )
    print("These must match QUICK_DRAW_RASTER in src/lib/quickdraw/raster.ts")


if __name__ == "__main__":
    main()
