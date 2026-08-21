#!/usr/bin/env python3
"""Export the browser recognizer: TFLite -> ONNX, quantize, and verify parity.

The recognizer that ships to browsers is an ONNX build of the SE-ResNet in
`public/models/quickdraw-tflite`. ONNX is what lets the accuracy suite make claims
about the deployed model: `onnxruntime-web` and `onnxruntime-node` load the same
file, so a number measured in CI is a number about production.

    source ml/.venv/bin/activate
    pip install tf2onnx onnx onnxruntime
    python ml/export_onnx_recognizer.py

Writes `quickdraw.onnx` (float32) and `quickdraw_int8.onnx` into
`public/models/quickdraw-onnx`, then checks both against the original TFLite
interpreter on real drawings and refuses to ship a build that disagrees.

Note the input convention, which is the opposite of what the TFLite metadata in this
repo claims: an inked pixel is 1.0 and blank paper is 0.0, matching the polarity of
Google's published bitmaps. Feeding the inverse costs essentially all accuracy while
still producing confident-looking output, so it is asserted here and again in
`src/lib/quickdraw/recognizer.accuracy.test.ts`.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TFLITE_MODEL = PROJECT_ROOT / "public/models/quickdraw-tflite/quickdraw_model.tflite"
TFLITE_CLASSES = PROJECT_ROOT / "public/models/quickdraw-tflite/classes.json"
BITMAP_DIR = PROJECT_ROOT / "ml/data/numpy_bitmap"
OUTPUT_DIR = PROJECT_ROOT / "public/models/quickdraw-onnx"

FLOAT_MODEL = "quickdraw.onnx"
INT8_MODEL = "quickdraw_int8.onnx"

VERIFY_CLASSES = ["cat", "airplane", "apple", "bicycle", "clock", "house", "star", "tree"]
VERIFY_PER_CLASS = 24


def convert(opset: int) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Converting {TFLITE_MODEL.name} to ONNX (opset {opset})")
    subprocess.run(
        [
            sys.executable, "-m", "tf2onnx.convert",
            "--tflite", str(TFLITE_MODEL),
            "--output", str(OUTPUT_DIR / FLOAT_MODEL),
            "--opset", str(opset),
        ],
        check=True,
    )

    from onnxruntime.quantization import QuantType, quantize_dynamic

    print("Quantizing weights to int8")
    quantize_dynamic(
        OUTPUT_DIR / FLOAT_MODEL,
        OUTPUT_DIR / INT8_MODEL,
        weight_type=QuantType.QUInt8,
    )

    classes = json.loads(TFLITE_CLASSES.read_text(encoding="utf-8"))
    (OUTPUT_DIR / "classes.json").write_text(json.dumps(classes, indent=2) + "\n", encoding="utf-8")


def load_verification_samples() -> list[tuple[str, np.ndarray]]:
    """Loads published bitmaps as ink-major float arrays, ink 1.0 on 0.0 paper."""
    samples: list[tuple[str, np.ndarray]] = []
    for name in VERIFY_CLASSES:
        path = BITMAP_DIR / f"{name}.npy"
        if not path.exists():
            continue
        bitmaps = np.load(path, mmap_mode="r")
        for row in np.asarray(bitmaps[-VERIFY_PER_CLASS:]):
            samples.append((name, row.reshape(1, 28, 28, 1).astype(np.float32) / 255.0))
    return samples


def verify() -> None:
    import onnxruntime as ort
    import tensorflow as tf

    samples = load_verification_samples()
    if not samples:
        print(f"  no bitmaps under {BITMAP_DIR}; skipping verification")
        return

    classes = json.loads((OUTPUT_DIR / "classes.json").read_text(encoding="utf-8"))
    interpreter = tf.lite.Interpreter(model_path=str(TFLITE_MODEL))
    interpreter.allocate_tensors()
    tflite_input = interpreter.get_input_details()[0]
    tflite_output = interpreter.get_output_details()[0]

    def tflite_predict(x: np.ndarray) -> np.ndarray:
        interpreter.set_tensor(tflite_input["index"], x)
        interpreter.invoke()
        return interpreter.get_tensor(tflite_output["index"])[0]

    for model_name in (FLOAT_MODEL, INT8_MODEL):
        session = ort.InferenceSession(str(OUTPUT_DIR / model_name))
        input_name = session.get_inputs()[0].name

        max_difference = 0.0
        agreements = 0
        correct = 0
        inverted_correct = 0

        for word, x in samples:
            reference = tflite_predict(x)
            predicted = session.run(None, {input_name: x})[0][0]
            max_difference = max(max_difference, float(np.abs(reference - predicted).max()))
            agreements += int(np.argmax(reference) == np.argmax(predicted))
            correct += int(classes[int(np.argmax(predicted))] == word)

            inverted = session.run(None, {input_name: 1.0 - x})[0][0]
            inverted_correct += int(classes[int(np.argmax(inverted))] == word)

        total = len(samples)
        accuracy = correct / total
        inverted_accuracy = inverted_correct / total
        print(
            f"  {model_name}: agreement {agreements}/{total}, max prob delta {max_difference:.2e}, "
            f"top-1 {accuracy:.1%} (inverted input {inverted_accuracy:.1%})"
        )

        if agreements / total < 0.95:
            raise SystemExit(f"{model_name} disagrees with the TFLite reference; not shipping it.")
        if accuracy < 0.6:
            raise SystemExit(f"{model_name} scored {accuracy:.1%} on known drawings; not shipping it.")
        if inverted_accuracy > accuracy / 2:
            raise SystemExit(
                "Inverted input scored too well, so the expected polarity is unclear. "
                "Check that ink is 1.0 and blank paper is 0.0 before shipping."
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--skip-convert", action="store_true")
    args = parser.parse_args()

    if not args.skip_convert:
        convert(args.opset)

    print("Verifying exports against the TFLite reference")
    verify()

    for name in (FLOAT_MODEL, INT8_MODEL):
        size_mb = (OUTPUT_DIR / name).stat().st_size / 1_048_576
        print(f"  {name}: {size_mb:.2f} MB")
    print(f"\nWrote {OUTPUT_DIR.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
