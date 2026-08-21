/**
 * Full-dataset accuracy benchmark for the shipped Quick Draw recognizer.
 *
 * Reads Google's `full/simplified` NDJSON stroke files from `ml/data/strokes/simplified`,
 * runs them through the exact rasterizer and ONNX model the browser uses, and reports
 * top-1 / top-3 / top-5 / MAP@3 with per-class and confusion breakdowns.
 *
 *   npm run bench:recognizer -- --per-class 50
 *   npm run bench:recognizer -- --variant int8 --per-class 20
 *   npm run bench:recognizer -- --stroke-fraction 0.5 --per-class 10
 *
 * `--offset` skips the head of each class file. The bundled model was trained on the
 * first 8,000 drawings per class, so the default offset keeps evaluation honest.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { evaluateRecognizer, type EvaluationSample } from "@/lib/quickdraw/evaluation";
import { hasLocalStrokeDataset, sampleClass, STROKE_DATA_DIR } from "./lib/ndjson";
import { loadNodeRecognizer, type NodeRecognizerVariant } from "./lib/node-recognizer";

const DEFAULT_OFFSET = 20_000;
const REPORT_DIR = join(process.cwd(), "ml/artifacts/recognizer");

type Options = {
  variant: NodeRecognizerVariant;
  perClass: number;
  offset: number;
  classLimit: number | null;
  strokeFraction: number;
  includeUnrecognized: boolean;
  report: string | null;
};

function parseOptions(argv: string[]): Options {
  const options: Options = {
    variant: "float32",
    perClass: 20,
    offset: DEFAULT_OFFSET,
    classLimit: null,
    strokeFraction: 1,
    includeUnrecognized: false,
    report: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--variant":
        options.variant = value === "int8" ? "int8" : "float32";
        index += 1;
        break;
      case "--per-class":
        options.perClass = Number(value);
        index += 1;
        break;
      case "--offset":
        options.offset = Number(value);
        index += 1;
        break;
      case "--classes":
        options.classLimit = Number(value);
        index += 1;
        break;
      case "--stroke-fraction":
        options.strokeFraction = Number(value);
        index += 1;
        break;
      case "--include-unrecognized":
        options.includeUnrecognized = true;
        break;
      case "--report":
        options.report = value;
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (!hasLocalStrokeDataset()) {
    console.error(
      `No stroke dataset at ${STROKE_DATA_DIR}.\n` +
        "Download it with: python ml/train_quickdraw_strokes.py --download-only",
    );
    process.exitCode = 1;
    return;
  }

  const recognizer = await loadNodeRecognizer(options.variant);
  const classes = options.classLimit
    ? recognizer.classes.slice(0, options.classLimit)
    : recognizer.classes;

  console.log(
    `Benchmarking ${options.variant} over ${classes.length} classes ` +
      `x ${options.perClass} drawings (offset ${options.offset}, strokes ${options.strokeFraction})`,
  );

  const samples: EvaluationSample[] = [];
  for (const word of classes) {
    const drawings = await sampleClass(word, {
      limit: options.perClass,
      offset: options.offset,
      recognizedOnly: !options.includeUnrecognized,
    });
    for (const drawing of drawings) {
      samples.push({ word: drawing.word, strokes: drawing.strokes, keyId: drawing.keyId });
    }
    if (samples.length % 2000 < options.perClass) {
      process.stdout.write(`\r  loaded ${samples.length} drawings`);
    }
  }
  process.stdout.write(`\r  loaded ${samples.length} drawings\n`);

  const started = Date.now();
  const result = await evaluateRecognizer(samples, recognizer.classes, recognizer.run, {
    strokeFraction: options.strokeFraction,
    onProgress: (completed, total) => {
      if (completed % 500 === 0 || completed === total) {
        process.stdout.write(`\r  scored ${completed}/${total}`);
      }
    },
  });
  const elapsed = Date.now() - started;
  process.stdout.write("\n");

  const [low, high] = result.top1Interval;
  console.log("");
  console.log(`  samples      ${result.samples}`);
  console.log(`  top-1        ${pct(result.top1)}  (95% CI ${pct(low)} - ${pct(high)})`);
  console.log(`  top-3        ${pct(result.top3)}`);
  console.log(`  top-5        ${pct(result.top5)}`);
  console.log(`  MAP@3        ${result.map3.toFixed(4)}`);
  console.log(`  macro top-1  ${pct(result.macroTop1)}`);
  console.log(`  latency      ${(elapsed / Math.max(result.samples, 1)).toFixed(2)} ms/drawing`);
  console.log("");
  console.log("  hardest classes:");
  for (const entry of result.worstClasses.slice(0, 15)) {
    console.log(`    ${entry.word.padEnd(24)} top1 ${pct(entry.top1)}  top3 ${pct(entry.top3)}`);
  }
  console.log("");
  console.log("  most common confusions:");
  for (const pair of result.confusions.slice(0, 15)) {
    console.log(`    ${pair.expected.padEnd(24)} -> ${pair.predicted.padEnd(24)} ${pair.count}`);
  }

  await recognizer.release();

  const reportPath =
    options.report ??
    join(
      REPORT_DIR,
      `benchmark-${options.variant}-${options.perClass}pc-f${options.strokeFraction}.json`,
    );
  await mkdir(join(reportPath, ".."), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify({ options, elapsedMs: elapsed, ...result }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\n  report written to ${reportPath}`);
}

function pct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
