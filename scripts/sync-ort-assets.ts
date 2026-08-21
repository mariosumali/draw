/**
 * Copies the ONNX Runtime Web WASM binaries into `public/ort` so the recognizer loads
 * entirely from this origin, with no CDN dependency at runtime.
 *
 *   npm run sync:ort
 *
 * The asset names are read out of the runtime bundle rather than hardcoded. Different
 * ONNX Runtime entry points want different binaries - the default entry loads the
 * larger `.jsep` build for WebGPU, while `onnxruntime-web/wasm` loads the plain one -
 * and a hardcoded list silently ships the wrong file, which only shows up as a 404 in
 * the browser. `assets.test.ts` re-derives the same list and checks it is present.
 *
 * Re-run after upgrading `onnxruntime-web`.
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGE_DIR = join(process.cwd(), "node_modules/onnxruntime-web");
const SOURCE_DIR = join(PACKAGE_DIR, "dist");
const TARGET_DIR = join(process.cwd(), "public/ort");

/**
 * The entry `src/lib/quickdraw/onnx.ts` imports. Keep the two in step: importing a
 * different entry changes which binaries the browser asks for.
 */
export const ORT_ENTRY_BUNDLE = "ort.wasm.bundle.min.mjs";

/** Reads the binary filenames an ONNX Runtime Web bundle will request at runtime. */
export async function readRequiredOrtAssets(bundle = ORT_ENTRY_BUNDLE, dir = SOURCE_DIR) {
  const source = await readFile(join(dir, bundle), "utf8");
  const matches = source.match(/ort-wasm[a-zA-Z0-9._-]*\.(?:mjs|wasm)/g) ?? [];
  return [...new Set(matches)].sort();
}

async function main() {
  const assets = await readRequiredOrtAssets();
  if (assets.length === 0) {
    throw new Error(`Found no WASM asset names in ${ORT_ENTRY_BUNDLE}. Did the package layout change?`);
  }

  await mkdir(TARGET_DIR, { recursive: true });
  for (const asset of assets) {
    await copyFile(join(SOURCE_DIR, asset), join(TARGET_DIR, asset));
    console.log(`  copied ${asset}`);
  }

  const { version } = JSON.parse(await readFile(join(PACKAGE_DIR, "package.json"), "utf8")) as {
    version: string;
  };

  await writeFile(
    join(TARGET_DIR, "VERSION"),
    [
      `onnxruntime-web ${version}`,
      `entry ${ORT_ENTRY_BUNDLE}`,
      `assets ${assets.join(", ")}`,
      "Regenerate with: npm run sync:ort",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`  onnxruntime-web ${version} assets are in public/ort`);
}

if (process.argv[1]?.endsWith("sync-ort-assets.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
