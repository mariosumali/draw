# Quick Draw Model Assets

Place a TensorFlow.js Layers model bundle here:

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

DoodleNet is a known 345-class Quick Draw CNN converted to TensorFlow.js, but confirm its license before vendoring the weights in this repo.
