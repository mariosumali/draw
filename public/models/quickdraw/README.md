# Quick Draw Model Assets

Place or export a TensorFlow.js Layers model bundle here:

- `model.json`
- model weight shard files referenced by `model.json`
- `classes.json`

`classes.json` must be a JSON array of labels in the exact output order used by the model.

The app expects a Quick Draw-style CNN input of `1 x 28 x 28 x 1` grayscale pixels normalized to `0..1`, where darker ink has higher values.

Suggested model path:

```text
public/models/quickdraw/model.json
public/models/quickdraw/group1-shard1ofN.bin
public/models/quickdraw/classes.json
```

The recommended path is to regenerate these assets with `ml/train_quickdraw.py`,
which trains from the official Google QuickDraw numpy bitmap dataset and writes
`model.json`, weight shards, `classes.json`, and `model-metadata.json` here.

The Google QuickDraw dataset is published under Creative Commons Attribution 4.0
International. Keep attribution in project documentation when shipping generated
model assets.
