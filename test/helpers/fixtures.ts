import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Stroke } from "@/lib/quickdraw/raster";

const FIXTURE_DIR = join(process.cwd(), "test/fixtures");

type RawDrawing = [number[], number[]][];

type EvalFixture = {
  offset: number;
  perClass: number;
  drawings: Array<{ word: string; keyId: string; drawing: RawDrawing }>;
};

type BitmapFixture = {
  drawings: Array<{
    word: string;
    keyId: string;
    lineIndex: number;
    drawing: RawDrawing;
    bitmap: string;
  }>;
};

export type EvalDrawing = {
  word: string;
  keyId: string;
  strokes: Stroke[];
};

export type BitmapDrawing = EvalDrawing & {
  /** Google's published 28x28 bitmap, as ink coverage in [0, 1] with 0 as blank paper. */
  bitmap: Float32Array;
};

export function toStrokes(drawing: RawDrawing): Stroke[] {
  return drawing.map(([xs, ys]) => xs.map((x, index) => ({ x, y: ys[index] })));
}

/** Held-out drawings for accuracy measurement. Rebuild with `npm run fixtures:build`. */
export function loadEvalDrawings(): EvalDrawing[] {
  const fixture = readJson<EvalFixture>("quickdraw-eval.json");
  return fixture.drawings.map((entry) => ({
    word: entry.word,
    keyId: entry.keyId,
    strokes: toStrokes(entry.drawing),
  }));
}

/** Drawings paired with Google's own bitmap render of the same drawing. */
export function loadBitmapDrawings(): BitmapDrawing[] {
  const fixture = readJson<BitmapFixture>("quickdraw-bitmaps.json");
  return fixture.drawings.map((entry) => {
    const bytes = Buffer.from(entry.bitmap, "base64");
    const bitmap = new Float32Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      bitmap[index] = bytes[index] / 255;
    }

    return {
      word: entry.word,
      keyId: entry.keyId,
      strokes: toStrokes(entry.drawing),
      bitmap,
    };
  });
}

/** Intersection over union of two ink maps, thresholded at half coverage. */
export function inkIoU(left: Float32Array, right: Float32Array, threshold = 0.5) {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] > threshold;
    const b = right[index] > threshold;
    if (a && b) {
      intersection += 1;
    }
    if (a || b) {
      union += 1;
    }
  }
  return union === 0 ? 1 : intersection / union;
}

export function translateStrokes(strokes: readonly Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((stroke) => stroke.map((point) => ({ x: point.x + dx, y: point.y + dy })));
}

export function scaleStrokes(strokes: readonly Stroke[], factor: number): Stroke[] {
  return strokes.map((stroke) => stroke.map((point) => ({ x: point.x * factor, y: point.y * factor })));
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}
