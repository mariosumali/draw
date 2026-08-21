/**
 * Builds the committed evaluation fixtures from the local Quick Draw dataset.
 *
 *   npm run fixtures:build
 *
 * Two fixtures are produced:
 *
 * - `quickdraw-eval.json` - held-out drawings used to measure recognizer accuracy in
 *   CI without needing the 22 GB dataset checked out.
 * - `quickdraw-bitmaps.json` - drawings paired with Google's own published 28x28
 *   bitmap for the same drawing, used to prove the rasterizer still reproduces the
 *   training distribution.
 *
 * The two fixtures are built differently on purpose. Accuracy sampling filters to
 * drawings Google's recognizer accepted, which is the population the game cares about.
 * Bitmap pairing cannot filter, because `numpy_bitmap` rows are positional: row N is
 * line N of the NDJSON, so skipping lines would silently mispair drawings and labels.
 */

import { createReadStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";

import { hasLocalStrokeDataset, sampleClass, STROKE_DATA_DIR } from "./lib/ndjson";
import type { QuickDrawRecord } from "./lib/ndjson";

const CLASSES_PATH = join(process.cwd(), "public/models/quickdraw-onnx/classes.json");
const BITMAP_DIR = join(process.cwd(), "ml/data/numpy_bitmap");
const FIXTURE_DIR = join(process.cwd(), "test/fixtures");

/** Drawings per class in the accuracy fixture. 345 x 4 keeps CI near ten seconds. */
const EVAL_PER_CLASS = 4;
/**
 * Skips the head of each class file. The bundled model was trained on the first 8,000
 * drawings per class, so evaluating past that keeps the measurement honest.
 */
const EVAL_OFFSET = 20_000;

/** Classes and drawings used for bitmap parity. A small sample is enough to pin the recipe. */
const BITMAP_CLASSES = 24;
const BITMAP_PER_CLASS = 4;

type EvalFixture = {
  source: string;
  license: string;
  offset: number;
  perClass: number;
  drawings: Array<{ word: string; keyId: string; drawing: [number[], number[]][] }>;
};

type BitmapFixture = {
  source: string;
  license: string;
  note: string;
  /** Each entry pairs a drawing with the published 28x28 bitmap of that same drawing. */
  drawings: Array<{
    word: string;
    keyId: string;
    lineIndex: number;
    drawing: [number[], number[]][];
    /** Base64 of the raw 784-byte grayscale bitmap, ink 255 on a 0 background. */
    bitmap: string;
  }>;
};

async function main() {
  if (!hasLocalStrokeDataset()) {
    console.error(`No stroke dataset at ${STROKE_DATA_DIR}. Fixtures cannot be rebuilt.`);
    process.exitCode = 1;
    return;
  }

  const classes = JSON.parse(await readText(CLASSES_PATH)) as string[];
  await mkdir(FIXTURE_DIR, { recursive: true });

  await buildEvalFixture(classes);
  await buildBitmapFixture(classes);
}

async function buildEvalFixture(classes: string[]) {
  const fixture: EvalFixture = {
    source: "googlecreativelab/quickdraw-dataset full/simplified",
    license: "CC BY 4.0",
    offset: EVAL_OFFSET,
    perClass: EVAL_PER_CLASS,
    drawings: [],
  };

  for (const word of classes) {
    const drawings = await sampleClass(word, {
      limit: EVAL_PER_CLASS,
      offset: EVAL_OFFSET,
      recognizedOnly: true,
    });

    for (const drawing of drawings) {
      fixture.drawings.push({
        word: drawing.word,
        keyId: drawing.keyId,
        drawing: drawing.strokes.map((stroke) => [
          stroke.map((point) => Math.round(point.x)),
          stroke.map((point) => Math.round(point.y)),
        ]),
      });
    }
  }

  const path = join(FIXTURE_DIR, "quickdraw-eval.json");
  await writeFile(path, `${JSON.stringify(fixture)}\n`, "utf8");
  console.log(`  ${fixture.drawings.length} drawings -> ${path}`);
}

async function buildBitmapFixture(classes: string[]) {
  const { readFile } = await import("node:fs/promises");
  const fixture: BitmapFixture = {
    source: "googlecreativelab/quickdraw-dataset full/simplified + full/numpy_bitmap",
    license: "CC BY 4.0",
    note: "bitmap is Google's published 28x28 render of this exact drawing",
    drawings: [],
  };

  const step = Math.max(1, Math.floor(classes.length / BITMAP_CLASSES));
  const selected = classes.filter((_, index) => index % step === 0).slice(0, BITMAP_CLASSES);

  for (const word of selected) {
    const bitmapPath = join(BITMAP_DIR, `${word}.npy`);
    if (!existsSync(bitmapPath)) {
      console.warn(`  skipping ${word}: no bitmap file`);
      continue;
    }

    const buffer = await readFile(bitmapPath);
    const { dataStart, rows, columns } = parseNpyHeader(buffer);
    if (columns !== 784) {
      console.warn(`  skipping ${word}: unexpected bitmap width ${columns}`);
      continue;
    }

    const records = await readLeadingRecords(word, BITMAP_PER_CLASS);
    for (const { record, lineIndex } of records) {
      if (lineIndex >= rows) {
        continue;
      }

      const start = dataStart + lineIndex * columns;
      fixture.drawings.push({
        word: record.word,
        keyId: record.key_id,
        lineIndex,
        drawing: record.drawing,
        bitmap: buffer.subarray(start, start + columns).toString("base64"),
      });
    }
  }

  const path = join(FIXTURE_DIR, "quickdraw-bitmaps.json");
  await writeFile(path, `${JSON.stringify(fixture)}\n`, "utf8");
  console.log(`  ${fixture.drawings.length} bitmap pairs -> ${path}`);
}

/**
 * Reads the first `limit` lines of a class file, keeping the line index.
 *
 * No filtering happens here: the index must stay aligned with the bitmap row.
 */
async function readLeadingRecords(word: string, limit: number) {
  const path = join(STROKE_DATA_DIR, `${word}.ndjson`);
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  const records: Array<{ record: QuickDrawRecord; lineIndex: number }> = [];

  let lineIndex = 0;
  try {
    for await (const line of lines) {
      if (line) {
        records.push({ record: JSON.parse(line) as QuickDrawRecord, lineIndex });
      }
      lineIndex += 1;
      if (records.length >= limit) {
        break;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return records;
}

/** Minimal `.npy` v1 header parser - enough for the 2-D uint8 arrays Google publishes. */
function parseNpyHeader(buffer: Buffer) {
  if (buffer.subarray(0, 6).toString("latin1") !== "\x93NUMPY") {
    throw new Error("Not a .npy file.");
  }

  const headerLength = buffer.readUInt16LE(8);
  const header = buffer.subarray(10, 10 + headerLength).toString("latin1");
  const shapeMatch = header.match(/'shape':\s*\((\d+),\s*(\d+)\)/);
  const descrMatch = header.match(/'descr':\s*'([^']+)'/);
  if (!shapeMatch || !descrMatch) {
    throw new Error(`Unsupported .npy header: ${header}`);
  }
  if (!descrMatch[1].includes("u1")) {
    throw new Error(`Expected uint8 bitmaps, found ${descrMatch[1]}.`);
  }

  return {
    dataStart: 10 + headerLength,
    rows: Number(shapeMatch[1]),
    columns: Number(shapeMatch[2]),
  };
}

async function readText(path: string) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
