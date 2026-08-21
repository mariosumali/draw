import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeLabel } from "@/lib/game/types";
import { DEFAULT_QUICK_DRAW_MODEL_ID, QUICK_DRAW_MODELS } from "@/lib/quickdraw/model";
import { ORT_ENTRY_BUNDLE, readRequiredOrtAssets } from "../../../scripts/sync-ort-assets";

const publicDir = join(process.cwd(), "public");

/**
 * Checks that everything the recognizer fetches at runtime is actually on disk.
 *
 * The accuracy suite would catch a broken model, but only after loading it. These are
 * the cheap checks that fail immediately and point at the missing file, and they are
 * the ones that catch an asset that was never committed.
 */
describe("Quick Draw model assets", () => {
  it("ships the 345-category Quick Draw prompt list", async () => {
    const categories = JSON.parse(
      await readFile(join(publicDir, "models/quickdraw-categories/categories.json"), "utf8"),
    ) as unknown;

    expect(Array.isArray(categories)).toBe(true);
    expect(categories).toHaveLength(345);
  });

  it("ships every asset the active recognizer fetches", async () => {
    const descriptor = QUICK_DRAW_MODELS.find((model) => model.id === DEFAULT_QUICK_DRAW_MODEL_ID);
    expect(descriptor).toBeDefined();
    expect(descriptor!.backend).toBe("onnx");

    for (const url of [descriptor!.modelUrl, descriptor!.classesUrl, descriptor!.metadataUrl]) {
      expect(url.startsWith("/"), `${url} must be served from this origin`).toBe(true);
      expect(existsSync(join(publicDir, url)), `missing ${url}`).toBe(true);
    }

    const classes = JSON.parse(
      await readFile(join(publicDir, descriptor!.classesUrl), "utf8"),
    ) as unknown;
    expect(Array.isArray(classes)).toBe(true);
    expect(classes).toHaveLength(345);
    expect(new Set((classes as string[]).map(normalizeLabel)).size).toBe(345);
  });

  it("ships exactly the WASM binaries the bundled ONNX Runtime asks for", async () => {
    // Derived from the runtime bundle rather than listed by hand. Different ONNX
    // Runtime entry points request different binaries, and shipping the wrong pair
    // fails only in the browser, as a 404 the recognizer reports as "assets missing".
    const required = await readRequiredOrtAssets();
    expect(required.length).toBeGreaterThan(0);

    for (const asset of required) {
      const path = join(publicDir, "ort", asset);
      expect(existsSync(path), `missing public/ort/${asset} - run npm run sync:ort`).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(1024);
    }
  });

  it("pins the ONNX Runtime build the copied binaries came from", async () => {
    // A package upgrade that leaves stale binaries behind loads a mismatched runtime.
    const version = JSON.parse(
      await readFile(join(process.cwd(), "node_modules/onnxruntime-web/package.json"), "utf8"),
    ).version as string;
    const stamp = await readFile(join(publicDir, "ort/VERSION"), "utf8");

    expect(stamp, "public/ort is stale - run npm run sync:ort").toContain(version);
    expect(stamp).toContain(ORT_ENTRY_BUNDLE);
  });

  it("keeps the shipped model small enough to load over a slow connection", () => {
    const path = join(publicDir, "models/quickdraw-onnx/quickdraw_int8.onnx");
    expect(statSync(path).size).toBeLessThan(6 * 1024 * 1024);
  });

  it("wires the recognizer to the input polarity the model was verified against", async () => {
    // The chain this guards: `recognizer.accuracy.test.ts` proves that ink-as-1 is the
    // polarity the weights expect and that inverting it collapses accuracy. That test
    // drives the ONNX session directly, so it cannot see this flag - and this flag is
    // what the app actually classifies with. Flipping it back to "luminance" is the
    // bug the recognizer shipped with, and it fails no other test.
    const descriptor = QUICK_DRAW_MODELS.find((model) => model.id === DEFAULT_QUICK_DRAW_MODEL_ID)!;
    expect(descriptor.inputPolarity).toBe("ink");

    const metadata = JSON.parse(
      await readFile(join(publicDir, "models/quickdraw-onnx/model-metadata.json"), "utf8"),
    ) as { inputRange: string };
    expect(metadata.inputRange).toMatch(/1\.0 fully inked/);
  });

  it("documents the input contract the rasterizer relies on", async () => {
    const metadata = JSON.parse(
      await readFile(join(publicDir, "models/quickdraw-onnx/model-metadata.json"), "utf8"),
    ) as { inputShape: number[]; inputRange: string; classCount: number };

    expect(metadata.inputShape).toEqual([1, 28, 28, 1]);
    expect(metadata.classCount).toBe(345);
    // Ink is 1.0. Recording the opposite here is how the previous recognizer ended up
    // wired backwards.
    expect(metadata.inputRange).toMatch(/0\.0 blank paper to 1\.0 fully inked/);
  });

  it.each(["quickdraw", "doodlenet"])("ships every weight shard referenced by %s", async (modelId) => {
    const modelDir = join(publicDir, "models", modelId);
    const modelJson = JSON.parse(await readFile(join(modelDir, "model.json"), "utf8")) as {
      weightsManifest?: Array<{ paths?: string[] }>;
    };

    const shardPaths = modelJson.weightsManifest?.flatMap((manifest) => manifest.paths ?? []) ?? [];
    expect(shardPaths.length).toBeGreaterThan(0);
    for (const shardPath of shardPaths) {
      expect(existsSync(join(modelDir, shardPath))).toBe(true);
    }
  });
});
