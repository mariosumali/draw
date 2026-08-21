# DoodleNet Model Assets

The app currently loads this pretrained 345-class QuickDraw model.

- Source: https://github.com/yining1023/doodleNet/tree/master/demo/DoodleClassifier_345
- Model: `model.json`
- Weights: `group1-shard1of1.bin`
- Labels: `classes.json`

`classes.json` is generated from the upstream demo's `CLASSES` array and must
stay in the same order as the model output.

The upstream README describes this model as trained on all 345 QuickDraw classes
with 50k images per class. Keep this folder separate from `public/models/quickdraw`,
which contains the locally trained model assets for comparison.
