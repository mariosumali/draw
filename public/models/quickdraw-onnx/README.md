# QuickDraw ONNX recognizer

The recognizer the game ships. `quickdraw_int8.onnx` (4.3 MB) is loaded by
`src/lib/quickdraw/model.ts` through `onnxruntime-web`; `quickdraw.onnx` is the
unquantized build kept for comparison and for the quantization-drift test.

## Why ONNX

`onnxruntime-web` and `onnxruntime-node` load the same file, so the accuracy suite in
`src/lib/quickdraw/recognizer.accuracy.test.ts` measures the model that actually
reaches players rather than a stand-in for it.

## Input contract

`[1, 28, 28, 1]` float32, **ink 1.0 on 0.0 blank paper**. This is the opposite of what
`public/models/quickdraw-tflite/model-metadata.json` claims. The inverted polarity
still returns confident-looking predictions while scoring near zero, so both
`ml/export_onnx_recognizer.py` and the accuracy suite assert it.

Build the input with `rasterizeStrokes` from `src/lib/quickdraw/raster.ts`. Do not
downscale the drawing canvas directly - that lands far outside the training
distribution and costs roughly 70 points of top-1 accuracy.

## Measured accuracy

10,350 held-out drawings (30 per class, past the 20,000th drawing in each class file):

| build   | top-1  | top-3  | top-5  | MAP@3  | size    |
| ------- | ------ | ------ | ------ | ------ | ------- |
| int8    | 80.29% | 93.80% | 96.24% | 0.8648 | 4.34 MB |
| float32 | 80.27% | 93.74% | 96.26% | 0.8644 | 16.9 MB |

Reproduce with `npm run bench:recognizer -- --per-class 30`.

## Regenerating

```bash
source ml/.venv/bin/activate
pip install tf2onnx onnx onnxruntime
python ml/export_onnx_recognizer.py
```

The script verifies each export against the original TFLite interpreter and refuses to
write a build that disagrees or that scores well on inverted input.

## Attribution

Trained on the Google Quick, Draw! dataset, published under CC BY 4.0.
Keep this attribution with any exported model asset.
