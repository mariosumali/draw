# The Quick Draw recognizer

How the game recognises drawings, why it is built this way, and how it is tested.

## Summary

| | |
| --- | --- |
| Model | SE-ResNet, 345 Quick Draw categories, `quickdraw_int8.onnx` (4.3 MB) |
| Runtime | `onnxruntime-web` (WASM) in the browser, `onnxruntime-node` in tests |
| Input | 28x28 float32, ink 1.0 on 0.0 blank paper, rendered from strokes |
| Accuracy | **80.3% top-1, 93.7% top-3, MAP@3 0.864** over 10,350 held-out drawings |
| Harder slices | 76.1% / 89.7% including drawings Google's own recognizer rejected; 50.8% / 69.3% at 60% of strokes drawn |
| Latency | ~5 ms per classification; the game classifies every 450 ms |
| Network | Fully local: no CDN, no server inference, works offline after first load |

## How a drawing becomes a prediction

The canvas keeps every stroke as an array of points. Recognition renders those strokes
from scratch rather than reading the canvas pixels:

1. **Normalise.** Scale the stroke bounding box uniformly into a 216x216 area centred
   on a 256x256 field. Position and size are discarded; only shape survives.
2. **Stroke.** Paint each path at 12.8 px with round caps and joins, using exact
   distance-to-segment coverage for antialiasing. Ink is combined with `max`, so
   overlapping strokes never read darker than a single one.
3. **Downscale.** Resample to 28x28 with a triangle filter.
4. **Classify.** Feed `[1, 28, 28, 1]` to the model and read softmax probabilities.

Steps 1-3 live in `src/lib/quickdraw/raster.ts` as pure arithmetic with no Canvas2D
dependency, which is what makes the browser and Node produce bit-identical inputs.

### Why re-render instead of reading the canvas

Those numbers are not arbitrary. Google published the 345 class bitmaps but not the
code that produced them, so the parameters were recovered by fitting renders against
the published bitmaps — row N of `<class>.npy` is line N of `<class>.ndjson`, which
makes it a direct optimisation. `ml/reverse_engineer_bitmaps.py` runs that search and
reports render size 256, a 20 px margin, a 12.8 px stroke and a bilinear downscale, at
about 0.93 mean IoU against ground truth.

Matching the training render matters more than anything else in this pipeline. Measured
on the same 400 drawings with the same weights, varying only how the input is built:

| input pipeline | top-1 | top-3 |
| --- | --- | --- |
| **Re-render strokes (what ships)** | **82.5%** | **93.8%** |
| Downscale the canvas, tight crop, better filter | 44.3% | 62.8% |
| Downscale the 720x520 canvas, 1.35x padding | 12.3% | 18.8% |

Whether the re-render actually reproduces the training distribution is a separate
question, and needs a strictly paired test: the same drawing, scored both from Google's
published bitmap of it and from our render of it. Over 2,760 such pairs:

| input | top-1 | top-3 |
| --- | --- | --- |
| Google's published bitmap | 76.45% | 90.36% |
| our render of the same drawing | 76.09% | 90.07% |

Equivalent, within noise. That is the intended result and the whole point - the render
matches the training distribution rather than beating it. Any earlier framing of the
re-render as *better* than the published bitmaps compared different drawings and was
wrong.

Downscaling a 720x520 canvas to 28x28 throws away roughly 26 pixels of every 27. A
12.6 px pen stroke lands as a sub-pixel smear whose weight depends on how large the
player happened to draw, which is nothing like the crisp, uniformly-scaled strokes the
model was trained on. Re-rendering removes the dependence on drawing size entirely.

`canvasToQuickDrawInput` still exists for surfaces without stroke history. It
normalises position and scale but cannot recover stroke weight, so prefer
`classifyStrokes`.

### Input polarity

Ink is **1.0**, blank paper is **0.0**. `public/models/quickdraw-tflite/model-metadata.json`
documents the opposite, and it is wrong. The inverted input scores **2.2% top-1 where
the correct one scores 77.8%**, while still producing confident-looking predictions —
there is no crash and no warning, just a recognizer that quietly never works. Both
`ml/export_onnx_recognizer.py` and the accuracy suite assert it.

### Confidence calibration

`calibrate.ts` used to multiply "animal migration" by 0.05, "camouflage" by 0.1 and
"rain" by 0.2, because the recognizer produced them constantly. That was the broken
input pipeline showing through: on near-noise input those labels were frequent
false positives.

With strokes rendered correctly they are not. Over 10,350 held-out drawings none of
the three appears among the most common false positives, and `rain` is one of the
strongest classes in the entire set at **93.3% top-1**.

The suppressions were also breaking the game. Every Quick Draw category is a prompt,
and the recognition threshold is 0.45, so capping `rain` at 0.2 meant a player who
drew rain perfectly could never score it. Three prompts were unwinnable.

The map is now empty. The mechanism stays for the case it was meant for, and
`calibrate.test.ts` fails on any entry that would put a prompt out of reach again.


## Does this rival Quick, Draw!?

Google's live game does not run the model they published. Their Cloud Blog states it
calls an internal API from the Handwriting team, and no production accuracy or latency
figures have ever been released. The public reference point is the TensorFlow tutorial
that team released, which reports **"approximately 70% on the top-1 candidate"** on the
same 345 classes after 1M training steps.

Against the published QuickDraw-345 leaderboard (SketchXAI, CVPR 2023, Table 1):

| model | top-1 | params |
| --- | --- | --- |
| SketchXAINet-Base | 87.21% | 91.7M |
| SketchXAINet-Tiny | 86.10% | 6.1M |
| Sketch-R2CNN (ResNet-101) | 85.30% | 51.7M |
| SketchAA | 81.51% | 26.7M |
| SketchMate | 80.51% | 64.7M |
| **this recognizer** | **80.29%** | **4.4M** |
| ResNet-50 | 78.76% | 24.2M |
| Swin-Base | 78.71% | 87.8M |
| SketchFormer | 78.34% | 13.1M |
| ViT-Base | 77.90% | 86.6M |
| Google's published tutorial RNN | ~70% | - |
| Sketch-a-Net | 68.71% | 8.5M |

So: comfortably past Google's own published baseline, ahead of ResNet-50, ViT-Base,
Swin-Base and SketchFormer, level with SketchMate at a fifteenth of the parameters, and
behind only the SketchXAI family and Sketch-R2CNN. Those all consume stroke sequences
and have no browser-runnable export; SketchXAI's author states the model takes strokes
as tokens and that no image processor or ONNX build exists.

Two caveats worth stating plainly:

- The live game is an easier task in practice than a top-1 benchmark. It accepts the
  target appearing anywhere in 20 returned candidates below a score threshold, polls
  roughly once a second for the whole round, and carries per-round synonyms. Feeling
  as good as Quick, Draw! depends at least as much on those dynamics as on top-1.
- It is also a harder task in one respect: its label vocabulary is larger than the 345
  public categories, so its numbers would not be directly comparable even if published.

## Testing strategy

Seven layers, each catching a class of failure the others cannot. Everything runs in
`npm test` in about 20 seconds, against committed fixtures, with no network access and
no 22 GB dataset checked out.

### 1. Rasterizer units — `raster.test.ts`

Shape of the output, range of its values, and the invariants: identical output for a
translated drawing, near-identical for a scaled one, aspect ratio preserved, margin
respected, overlapping strokes not compounding, lone points not dropped.

Written as exact-equality assertions where the property is exact. A drawing moved 500
pixels must produce the *same array*, not a similar one.

### 2. Dataset parity — `raster.parity.test.ts`

Renders 96 drawings and compares each against Google's own published bitmap of that
same drawing: mean IoU above 0.85, no single drawing below 0.7, mean per-pixel error
below 0.05, total ink within 25%.

This is the layer that fails if anyone changes the render constants. Without it the
model still loads, still returns predictions, and is quietly less accurate — the exact
failure that motivated this work.

### 3. Model accuracy — `recognizer.accuracy.test.ts`

The shipped weights over 1,380 held-out drawings, four per class, sampled past the
20,000th drawing in each class file so nothing overlaps the training data.

Asserts top-1 > 75%, top-3 > 90%, MAP@3 > 0.82, plus:

- **macro accuracy**, so easy classes cannot carry failing ones
- **no class at zero top-3**
- **the game's own threshold** — a correct but timid prediction never scores a point,
  so the shipped `RECOGNITION_CONFIDENCE` is exercised directly
- **partial drawings**, since the game classifies mid-sketch every 450 ms
- **confidence rising** as a drawing is completed
- **every game prompt** being a label the model can actually produce
- **inverted polarity collapsing**, which pins the contract above

Thresholds sit a few points under the measured values. The fixture carries a ~2 point
95% interval; every failure this suite targets costs tens of points.

### 4. Metamorphic robustness — `recognizer.robustness.test.ts`

Properties between two related inputs, with no need to know the right answer for
either — the class of bug a benchmark average hides:

- same prediction wherever the drawing sits, and however large it is
- same prediction regardless of stroke order
- same prediction when a high-refresh pointer emits twice as many points
- the 4.3 MB int8 build agreeing with the 16.9 MB float32 build above 97%
- output being a real probability distribution
- a stray dot not producing a confident answer

### 5. Game-rule guards — `calibrate.test.ts`

Confidence adjustments only reduce, only apply to real labels, and never hold a prompt
below the threshold the game needs to score it.

### 6. Metric units — `evaluation.test.ts`

The scoring itself, against hand-computed cases: MAP@3 from known ranks, macro vs
micro on a deliberately skewed set, Wilson intervals staying inside [0, 1] at the
extremes. The accuracy suite trusts these numbers, so they are not measured against
the model.

### 7. Asset integrity — `assets.test.ts`

Everything fetched at runtime exists, the label list has 345 unique entries, the model
stays under 6 MB, and the metadata records the polarity contract.

The ONNX Runtime binaries are checked against a list **derived from the runtime bundle**
rather than hardcoded. Different entry points request different binaries; shipping the
wrong pair produces a 404 that surfaces only in a browser, as a misleading "model
assets are missing" message. That bug happened during this work, and this is the test
that would have caught it.

### Beyond CI: full benchmark

```bash
npm run bench:recognizer -- --per-class 30              # 10,350 drawings
npm run bench:recognizer -- --variant float32           # compare quantization
npm run bench:recognizer -- --stroke-fraction 0.5       # half-finished drawings
npm run bench:recognizer -- --include-unrecognized      # the drawings Google rejected
```

Reads the local dataset, reports top-1/3/5, MAP@3, macro accuracy, per-class results,
confusion pairs and a Wilson interval, and writes a JSON report to
`ml/artifacts/recognizer/`.

### What is deliberately not tested here

Nothing mocks the model. There are no snapshot tests of prediction output — the
metamorphic tests pin behaviour that must hold rather than behaviour that happens to.
Browser rendering is not simulated: the rasterizer is pure arithmetic precisely so
there is no Canvas2D behaviour left to diverge.

## Known rough edges

`@huggingface/transformers` pins its own exact ONNX Runtime dev build, so two copies of
the runtime exist in the tree:

```
├─┬ @huggingface/transformers@4.2.0
│ └── onnxruntime-web@1.26.0-dev...
└── onnxruntime-web@1.27.0
```

Harmless today: transformers.js is only reached from `/dev/models`, behind a dynamic
import, and the two configure their WASM paths independently. Worth collapsing if the
MobileViT comparison is ever promoted out of the dev lab.

`public/tflite-wasm/` (~15 MB) is now dead weight - nothing loads it since the runtime
moved to ONNX. `public/models/quickdraw-tflite/` is still live as the provenance source
`ml/export_onnx_recognizer.py` converts from, and its metadata is the reference for
what *not* to trust about polarity.

## Regenerating

```bash
npm run sync:ort              # copy ONNX Runtime binaries into public/ort
npm run fixtures:build        # rebuild test fixtures (needs the local dataset)
python ml/export_onnx_recognizer.py         # re-export and verify the model
python ml/reverse_engineer_bitmaps.py       # re-derive the render parameters
```

## Attribution

Google Quick, Draw! dataset, CC BY 4.0.
<https://github.com/googlecreativelab/quickdraw-dataset>
