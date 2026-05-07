import {
  RECOGNITION_CONFIDENCE,
  RECOGNITION_TOP_N,
  normalizeLabel,
  type Prediction,
} from "@/lib/game/types";

const DEFAULT_CONFIDENCE_BUCKET = 0.05;

export function getPredictionSignature(
  predictions: Prediction[],
  topN = RECOGNITION_TOP_N,
  confidenceBucket = DEFAULT_CONFIDENCE_BUCKET,
) {
  return predictions
    .slice(0, topN)
    .map((prediction) => {
      const confidenceBucketIndex = Math.floor(prediction.confidence / confidenceBucket);
      return `${normalizeLabel(prediction.label)}:${confidenceBucketIndex}`;
    })
    .join("|");
}

export function isMatchingPrediction(
  prompt: string,
  prediction: Prediction,
  minConfidence = RECOGNITION_CONFIDENCE,
) {
  return normalizeLabel(prediction.label) === normalizeLabel(prompt) && prediction.confidence >= minConfidence;
}
