# QuickDraw Training Pipeline

This workspace trains a TensorFlow.js classifier from the official Google
QuickDraw dataset.

## Data Source

- Repository: https://github.com/googlecreativelab/quickdraw-dataset
- Dataset: `gs://quickdraw_dataset/full/numpy_bitmap`
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

## Notes

The first pass uses Google's pre-rendered `28x28` numpy bitmaps because they
match the current browser tensor shape. If runtime accuracy is still weak, the
next step is to train from simplified `.ndjson` vectors rendered through the
same crop, padding, antialiasing, and stroke-width rules as the app canvas.
