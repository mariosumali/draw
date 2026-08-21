# QuickDraw Training Pipeline

This workspace trains a TensorFlow.js classifier from the official Google
QuickDraw dataset.

## Data Source

- Repository: https://github.com/googlecreativelab/quickdraw-dataset
- Dataset: `gs://quickdraw_dataset/full/numpy_bitmap`
- Stroke dataset: `gs://quickdraw_dataset/full/simplified`
- License: Creative Commons Attribution 4.0 International

By default, the script downloads only the classes listed in
`src/lib/game/prompts.ts`. Use `--class-source quickdraw-345` to train on the
full official category list from Google’s `categories.txt`. Raw `.npy` files are
cached under `ml/data/` and must not be committed.

## Setup

```bash
python3 -m venv ml/.venv
source ml/.venv/bin/activate
pip install -r ml/requirements.txt
```

## Train And Export

```bash
python ml/train_quickdraw.py --samples-per-class 12000 --epochs 24
```

To train the full 345-class recognizer:

```bash
python ml/train_quickdraw.py --class-source quickdraw-345 --samples-per-class 5000 --epochs 24 --download-workers 8
```

The default export target is `public/models/quickdraw`, which is what the app
loads in the browser. Training also writes:

- `ml/artifacts/quickdraw/model.keras`
- `ml/artifacts/quickdraw/classes.json`
- `ml/artifacts/quickdraw/evaluation.json`

Use the evaluation report to compare top-1 and top-3 accuracy before shipping.
For game-only training, classes with weak top-3 accuracy should be removed,
renamed, or given more training data. For 345-class training, use the per-class
report to identify categories that need more samples or prompt-specific tuning.

## Stroke Sequence Model

`train_quickdraw_strokes.py` trains from QuickDraw NDJSON strokes instead of
pre-rendered bitmaps. It defaults to all 345 classes, `full/simplified` stroke
files, 5,000 drawings per class, and a TCN classifier over fixed-length stroke
tokens shaped `[max_points, 5]`:

```text
dx, dy, pen_down, pen_up, pen_end
```

Train the lower end of the target set, about 1.7M drawings:

```bash
python ml/train_quickdraw_strokes.py --samples-per-class 5000 --epochs 40 --download-workers 8 --prepare-workers 8
```

Train the upper end, about 3.45M drawings:

```bash
python ml/train_quickdraw_strokes.py --samples-per-class 10000 --epochs 40 --download-workers 8 --prepare-workers 8
```

The pipeline saves progress at three levels:

- Downloads: `ml/data/strokes/simplified/*.ndjson`; interrupted downloads resume via `curl --continue-at -` and `.part` files.
- Processed shards: `ml/artifacts/quickdraw-strokes/processed/<config-hash>/**/*.tfrecord`; completed class shards are skipped on rerun, and multiple classes convert in parallel via `--prepare-workers`.
- Training: `ml/artifacts/quickdraw-strokes/checkpoints/epoch-*.keras`, `batch-latest.keras`, `best.keras`, and TensorFlow `BackupAndRestore` state.

Useful restart commands:

```bash
# Download only, safe to interrupt and rerun.
python ml/train_quickdraw_strokes.py --samples-per-class 10000 --download-only

# Build TFRecord shards from already downloaded NDJSON.
python ml/train_quickdraw_strokes.py --samples-per-class 10000 --skip-download --prepare-only --prepare-workers 8

# Resume training from the newest checkpoint and existing shards.
python ml/train_quickdraw_strokes.py --samples-per-class 10000 --skip-download --skip-prepare --resume-from latest
```

Use `--checkpoint-batches 1000` to checkpoint more frequently on preemptible
machines, or `--checkpoint-batches 0` to keep only epoch-level checkpoints.

Use `--architecture bigru` for a recurrent baseline, but expect slower training
at 345 classes. Use `--stroke-source raw` only if you want Google's much larger
raw point streams; `simplified` is the practical default because it keeps stroke
order while reducing sequence length.

## Browser Recognizer

The model the game actually ships is built and validated from here.

```bash
python ml/export_onnx_recognizer.py      # TFLite -> ONNX, quantize, verify parity
python ml/reverse_engineer_bitmaps.py    # re-derive the bitmap render parameters
```

`export_onnx_recognizer.py` converts `public/models/quickdraw-tflite/quickdraw_model.tflite`
into `public/models/quickdraw-onnx/`, writes a float32 and an int8 build, and checks both
against the original TFLite interpreter on real drawings. It refuses to write a build
that disagrees with the reference or that scores well on inverted input.

`reverse_engineer_bitmaps.py` recovers how Google produced `full/numpy_bitmap` from the
simplified strokes, by fitting candidate render parameters against the published
bitmaps. Its answer - render at 256, 20 px margin, 12.8 px stroke, bilinear downscale -
is what `src/lib/quickdraw/raster.ts` implements. Rerun it if those constants change.

Accuracy is measured from the TypeScript side, against the exact code the browser runs:

```bash
npm run bench:recognizer -- --per-class 30
```

See [../docs/recognizer.md](../docs/recognizer.md).

## Notes

The game captures strokes and renders them itself, so any trainer here that consumes
the `1 x 28 x 28 x 1` bitmap tensor can be dropped in - just match the render in
`src/lib/quickdraw/raster.ts` and re-run the benchmark.

The stroke sequence trainer produces Keras artifacts for experimentation and is not
wired into gameplay. It is also not currently converging: `training-log.csv` shows
88.7% training accuracy against 26.7% validation, a gap far too wide to be
overfitting alone, which points at a mismatch between how the training and validation
shards were built rather than at the model.
