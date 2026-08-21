import { normalizeLabel, RECOGNITION_CONFIDENCE, type Prediction } from "@/lib/game/types";

/**
 * Per-label confidence adjustments, applied after the model and before the game reads
 * a prediction.
 *
 * Deliberately empty. It used to hold heavy suppressions for "animal migration",
 * "camouflage" and "rain", which the recognizer produced constantly - but that was an
 * artifact of feeding it downscaled canvas pixels, which are so far outside the
 * training distribution that predictions were close to noise. Rendering from strokes
 * removed the cause: measured over 10,350 held-out drawings those three labels never
 * appear among the most common false positives, while `rain` is one of the strongest
 * classes in the whole set at 93.3% top-1.
 *
 * The suppressions were also actively harmful, because every Quick Draw category is a
 * game prompt. Multiplying `rain` by 0.2 capped it below RECOGNITION_CONFIDENCE, so a
 * player drawing rain perfectly could never score it.
 *
 * The mechanism is kept for the case it was meant for: a label the model genuinely
 * over-predicts. Any entry added here must leave the label winnable, which
 * `calibrate.test.ts` enforces.
 */
const QUICK_DRAW_LABEL_CONFIDENCE_MULTIPLIERS = new Map<string, number>();

/**
 * The smallest multiplier that still lets a confidently-recognised drawing score.
 * A label held below this is unwinnable, not merely down-ranked.
 */
export const MIN_VIABLE_MULTIPLIER = RECOGNITION_CONFIDENCE;

export function calibrateQuickDrawPredictions(predictions: Prediction[]): Prediction[] {
  if (QUICK_DRAW_LABEL_CONFIDENCE_MULTIPLIERS.size === 0) {
    return predictions;
  }

  return predictions.map((prediction) => {
    const multiplier =
      QUICK_DRAW_LABEL_CONFIDENCE_MULTIPLIERS.get(normalizeLabel(prediction.label)) ?? 1;
    return multiplier === 1
      ? prediction
      : { ...prediction, confidence: prediction.confidence * multiplier };
  });
}

/** Exposed so tests can assert no label is suppressed out of reach of the game. */
export function getLabelConfidenceMultipliers(): ReadonlyMap<string, number> {
  return QUICK_DRAW_LABEL_CONFIDENCE_MULTIPLIERS;
}
