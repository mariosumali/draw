import { normalizeLabel } from "@/lib/game/types";
import { rasterizeStrokes, type RasterizeOptions, type Stroke } from "@/lib/quickdraw/raster";

export type EvaluationSample = {
  word: string;
  strokes: Stroke[];
  keyId?: string;
};

/** Runs one 28x28 ink map through a model and returns the class scores. */
export type ScoreRunner = (input: Float32Array) => Promise<Float32Array> | Float32Array;

export type ClassAccuracy = {
  samples: number;
  top1: number;
  top3: number;
};

export type ConfusionPair = {
  expected: string;
  predicted: string;
  count: number;
};

export type EvaluationResult = {
  samples: number;
  top1: number;
  top3: number;
  top5: number;
  /** Mean average precision at 3 - the metric the Kaggle Quick Draw challenge scored on. */
  map3: number;
  /** Unweighted mean of per-class top-1, so hard classes are not hidden by easy ones. */
  macroTop1: number;
  /** 95% Wilson score interval for the overall top-1 estimate. */
  top1Interval: [number, number];
  perClass: Record<string, ClassAccuracy>;
  worstClasses: Array<{ word: string } & ClassAccuracy>;
  confusions: ConfusionPair[];
};

export type EvaluateOptions = {
  /**
   * Keeps only the first `strokeFraction` of each drawing's strokes, which models
   * the partial sketches the game classifies while a player is still drawing.
   */
  strokeFraction?: number;
  /** Overrides the render geometry, for comparing candidate rasterizer settings. */
  rasterOptions?: RasterizeOptions;
  /** Invoked after each sample so long runs can report progress. */
  onProgress?: (completed: number, total: number) => void;
};

/**
 * Scores a recognizer over labelled drawings.
 *
 * Deliberately takes a `ScoreRunner` rather than a model, so the same evaluation runs
 * against ONNX in Node, ONNX in the browser, or any future backend, and so the numbers
 * always come from the same rasterizer the game ships.
 */
export async function evaluateRecognizer(
  samples: readonly EvaluationSample[],
  classes: readonly string[],
  run: ScoreRunner,
  options: EvaluateOptions = {},
): Promise<EvaluationResult> {
  const { strokeFraction = 1, rasterOptions, onProgress } = options;
  const indexByLabel = new Map(classes.map((label, index) => [normalizeLabel(label), index]));

  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  let map3Total = 0;
  let scored = 0;

  const perClass = new Map<string, { samples: number; top1: number; top3: number }>();
  const confusions = new Map<string, ConfusionPair>();

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const expectedIndex = indexByLabel.get(normalizeLabel(sample.word));
    if (expectedIndex === undefined) {
      throw new Error(`Sample label "${sample.word}" is not present in the class list.`);
    }

    const strokes = takeStrokeFraction(sample.strokes, strokeFraction);
    const input = rasterizeStrokes(strokes, rasterOptions);
    if (!input) {
      onProgress?.(sampleIndex + 1, samples.length);
      continue;
    }

    const scores = await run(input);
    const ranked = rankTop(scores, 5);

    scored += 1;
    const bucket = perClass.get(sample.word) ?? { samples: 0, top1: 0, top3: 0 };
    bucket.samples += 1;

    const rank = ranked.indexOf(expectedIndex);
    if (rank === 0) {
      top1 += 1;
      bucket.top1 += 1;
    } else {
      const predicted = classes[ranked[0]] ?? `class-${ranked[0]}`;
      const key = `${sample.word} -> ${predicted}`;
      const existing = confusions.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        confusions.set(key, { expected: sample.word, predicted, count: 1 });
      }
    }

    if (rank >= 0 && rank < 3) {
      top3 += 1;
      bucket.top3 += 1;
      map3Total += 1 / (rank + 1);
    }
    if (rank >= 0 && rank < 5) {
      top5 += 1;
    }

    perClass.set(sample.word, bucket);
    onProgress?.(sampleIndex + 1, samples.length);
  }

  const divisor = Math.max(scored, 1);
  const perClassRecord: Record<string, ClassAccuracy> = {};
  const classAccuracies: Array<{ word: string } & ClassAccuracy> = [];
  for (const [word, bucket] of perClass) {
    const accuracy: ClassAccuracy = {
      samples: bucket.samples,
      top1: bucket.top1 / bucket.samples,
      top3: bucket.top3 / bucket.samples,
    };
    perClassRecord[word] = accuracy;
    classAccuracies.push({ word, ...accuracy });
  }

  classAccuracies.sort((left, right) => left.top1 - right.top1 || left.word.localeCompare(right.word));

  return {
    samples: scored,
    top1: top1 / divisor,
    top3: top3 / divisor,
    top5: top5 / divisor,
    map3: map3Total / divisor,
    macroTop1: classAccuracies.length
      ? classAccuracies.reduce((total, entry) => total + entry.top1, 0) / classAccuracies.length
      : 0,
    top1Interval: wilsonInterval(top1, scored),
    perClass: perClassRecord,
    worstClasses: classAccuracies.slice(0, 25),
    confusions: [...confusions.values()].sort((left, right) => right.count - left.count).slice(0, 30),
  };
}

/** Returns the indices of the `count` highest scores, best first. */
export function rankTop(scores: ArrayLike<number>, count: number) {
  const best: number[] = [];
  for (let index = 0; index < scores.length; index += 1) {
    let position = best.length;
    while (position > 0 && scores[best[position - 1]] < scores[index]) {
      position -= 1;
    }
    if (position < count) {
      best.splice(position, 0, index);
      if (best.length > count) {
        best.pop();
      }
    }
  }
  return best;
}

export function takeStrokeFraction(strokes: readonly Stroke[], fraction: number): Stroke[] {
  if (fraction >= 1 || strokes.length === 0) {
    return [...strokes];
  }
  const keep = Math.max(1, Math.round(strokes.length * Math.max(fraction, 0)));
  return strokes.slice(0, keep);
}

/**
 * Wilson score interval - the honest way to report accuracy from a finite sample.
 * A normal approximation understates the interval badly near 0 or 1.
 */
export function wilsonInterval(successes: number, total: number, z = 1.96): [number, number] {
  if (total === 0) {
    return [0, 0];
  }
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = proportion + (z * z) / (2 * total);
  const spread = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total);
  return [
    Math.max(0, (centre - spread) / denominator),
    Math.min(1, (centre + spread) / denominator),
  ];
}
