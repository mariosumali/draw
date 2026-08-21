import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

import type { Stroke, StrokePoint } from "@/lib/quickdraw/raster";

/** A drawing as published in Google's `full/simplified` NDJSON files. */
export type QuickDrawRecord = {
  word: string;
  key_id: string;
  recognized: boolean;
  countrycode?: string;
  /** `[[xs, ys], ...]` in the 0..255 simplified coordinate space. */
  drawing: [number[], number[]][];
};

export type SampledDrawing = {
  word: string;
  keyId: string;
  recognized: boolean;
  strokes: Stroke[];
};

export const STROKE_DATA_DIR = join(process.cwd(), "ml/data/strokes/simplified");

export function hasLocalStrokeDataset(dir = STROKE_DATA_DIR) {
  return existsSync(dir);
}

export function toStrokes(drawing: QuickDrawRecord["drawing"]): Stroke[] {
  return drawing.map(([xs, ys]) => {
    const points: StrokePoint[] = [];
    for (let index = 0; index < xs.length; index += 1) {
      points.push({ x: xs[index], y: ys[index] });
    }
    return points;
  });
}

export type SampleOptions = {
  /** Drawings to collect per class. */
  limit: number;
  /** Drawings to skip first, so evaluation avoids the prefix used for training. */
  offset?: number;
  /** Keep only drawings Google's own recognizer accepted. */
  recognizedOnly?: boolean;
};

/**
 * Streams one class file and returns up to `limit` drawings.
 *
 * The files are hundreds of megabytes each, so this stops reading as soon as the
 * requested window is filled rather than parsing the whole file.
 */
export async function sampleClass(
  word: string,
  options: SampleOptions,
  dir = STROKE_DATA_DIR,
): Promise<SampledDrawing[]> {
  const { limit, offset = 0, recognizedOnly = true } = options;
  const path = join(dir, `${word}.ndjson`);
  if (!existsSync(path) || limit <= 0) {
    return [];
  }

  const collected: SampledDrawing[] = [];
  let skipped = 0;
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  try {
    for await (const line of lines) {
      if (!line) {
        continue;
      }

      const record = JSON.parse(line) as QuickDrawRecord;
      if (recognizedOnly && !record.recognized) {
        continue;
      }

      if (skipped < offset) {
        skipped += 1;
        continue;
      }

      collected.push({
        word: record.word,
        keyId: record.key_id,
        recognized: record.recognized,
        strokes: toStrokes(record.drawing),
      });

      if (collected.length >= limit) {
        break;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return collected;
}
