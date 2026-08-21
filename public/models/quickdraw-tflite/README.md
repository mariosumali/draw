# QuickDraw TFLite Model Assets

**Not loaded at runtime any more.** These files are the provenance source for the
recognizer the game actually ships, `public/models/quickdraw-onnx/`, which
`ml/export_onnx_recognizer.py` converts from `quickdraw_model.tflite`.

- Source: https://huggingface.co/zarqankhn/quickdraw-345-tflite
- Architecture: SE-ResNet (64 -> 128 -> 256), 4.41M parameters
- Trained on Google Quick Draw numpy bitmaps, 8,000 samples/class x 345 = 2.76M images
- Upstream reported accuracy: 76.19% top-1 / 89.51% top-3
- License: Apache-2.0. Dataset: CC BY 4.0.

## Correction: the polarity in `model-metadata.json` is wrong

`model-metadata.json` states `"background_value": "1.0 (white)"` and
`"stroke_value": "0.0 (black)"`, and the upstream Dart example says the same. Measured
against the model itself, the opposite is true: **an inked pixel is 1.0 and blank paper
is 0.0**, matching Google's published bitmaps, which are white ink on black.

Feeding the documented (inverted) polarity scores **2.2% top-1 where the correct
polarity scores 77.8%**, on the same 600 drawings and the same weights. Nothing errors -
the model returns confident, wrong predictions - which is how the app shipped wired
backwards. `ml/export_onnx_recognizer.py` refuses to write an export whose inverted
input scores anywhere near its correct one, and
`src/lib/quickdraw/recognizer.accuracy.test.ts` asserts the collapse directly.

## Why the runtime moved off TFLite

`@tensorflow/tfjs-tflite` is stale (last publish 2023-07-24, README still says "WORK IN
PROGRESS"), pins `@tensorflow/tfjs-core` to an exact `4.9.0` that conflicts with this
repo's 4.22.0, cannot be bundled, and cannot run in Node at all - so the shipped model
could never be tested outside a browser. ONNX Runtime loads the same graph in both.

See [../../../docs/recognizer.md](../../../docs/recognizer.md).
