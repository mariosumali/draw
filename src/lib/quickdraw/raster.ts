/**
 * Deterministic, dependency-free rasterizer that reproduces the Google Quick Draw
 * `numpy_bitmap` rendering pipeline.
 *
 * Google's own generator is a cairo `vector_to_raster()` posted by the dataset
 * maintainer in googlecreativelab/quickdraw-dataset issue #19: a 256-unit drawing box
 * with `padding=16` and `line_diameter=16`, scaled by `28/304` and stroked with round
 * caps and joins under `ANTIALIAS_BEST`. The constants below are the same proportions -
 * a 216/256 drawing box against Google's 256/304, and a stroke 5.9% of the drawing's
 * long edge against Google's 6.25% - recovered independently by fitting renders against
 * the published bitmaps (`ml/reverse_engineer_bitmaps.py`, ~0.93 mean IoU).
 *
 * The one deliberate departure is that this renders at 256 and resamples down, where
 * cairo rasterized straight to 28x28 with a sub-pixel 1.47 px line. Rendering directly
 * at 28 does reproduce the published bitmaps more exactly - mean error 3.3/255 against
 * 5.9/255 - but it classifies measurably *worse*: 79.4% top-1 against 81.5% over the
 * evaluation fixture, 62 drawings lost against 32 gained, McNemar chi-square 8.95
 * (p < 0.05). Supersampling appears to smooth away sub-pixel aliasing the model reads
 * as noise. Pixel fidelity was not the goal; accuracy was. `raster.parity.test.ts`
 * holds both ends of that trade.
 *
 * Rendering here rather than through Canvas2D keeps the result bit-identical between
 * the browser and Node, which is what lets the accuracy suite exercise the exact code
 * the game ships.
 */

export type StrokePoint = { x: number; y: number };
export type Stroke = readonly StrokePoint[];
export type StrokeBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type RasterizeOptions = {
  /** Edge length of the square canvas strokes are rendered onto. */
  renderSize?: number;
  /** Blank border kept on every side of the render canvas, in render pixels. */
  margin?: number;
  /** Stroke width used when rendering, in render pixels. */
  lineWidth?: number;
  /** Edge length of the square tensor handed to the model. */
  outputSize?: number;
};

/** Parameters recovered from Google's published `full/numpy_bitmap` files. */
export const QUICK_DRAW_RASTER = {
  renderSize: 256,
  margin: 20,
  lineWidth: 12.8,
  outputSize: 28,
} as const satisfies Required<RasterizeOptions>;

export function getStrokeBounds(strokes: readonly Stroke[]): StrokeBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const stroke of strokes) {
    for (const point of stroke) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        continue;
      }

      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function countStrokePoints(strokes: readonly Stroke[]) {
  return strokes.reduce((total, stroke) => total + stroke.length, 0);
}

/**
 * Renders strokes to a square ink map in `[0, 1]`, where `1` is fully inked.
 *
 * The output is scale- and translation-invariant: only the shape of the strokes
 * matters, never where on the drawing surface they were made or how large.
 * Returns `null` when the strokes carry no finite points.
 */
export function rasterizeStrokes(
  strokes: readonly Stroke[],
  options: RasterizeOptions = {},
): Float32Array | null {
  const renderSize = options.renderSize ?? QUICK_DRAW_RASTER.renderSize;
  const margin = options.margin ?? QUICK_DRAW_RASTER.margin;
  const lineWidth = options.lineWidth ?? QUICK_DRAW_RASTER.lineWidth;
  const outputSize = options.outputSize ?? QUICK_DRAW_RASTER.outputSize;

  const bounds = getStrokeBounds(strokes);
  if (!bounds) {
    return null;
  }

  const inkWidth = bounds.maxX - bounds.minX;
  const inkHeight = bounds.maxY - bounds.minY;
  const inner = renderSize - margin * 2;
  const span = Math.max(inkWidth, inkHeight);
  // A single dot has no extent on either axis. Scaling it up would be meaningless and
  // would push the offset arithmetic off the canvas, so leave it at 1:1 and let the
  // centring below place it. A straight line still has extent on one axis and scales
  // normally.
  const scale = span > 0 ? inner / span : 1;
  const offsetX = margin + (inner - inkWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = margin + (inner - inkHeight * scale) / 2 - bounds.minY * scale;

  const coverage = new Float32Array(renderSize * renderSize);
  const radius = lineWidth / 2;

  for (const stroke of strokes) {
    const points = stroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length === 0) {
      continue;
    }

    if (points.length === 1) {
      const { x, y } = points[0];
      paintDot(coverage, renderSize, x * scale + offsetX, y * scale + offsetY, radius);
      continue;
    }

    for (let index = 1; index < points.length; index += 1) {
      paintSegment(
        coverage,
        renderSize,
        points[index - 1].x * scale + offsetX,
        points[index - 1].y * scale + offsetY,
        points[index].x * scale + offsetX,
        points[index].y * scale + offsetY,
        radius,
      );
    }
  }

  return resampleTriangle(coverage, renderSize, renderSize, outputSize, outputSize);
}

/**
 * Paints a round-capped segment using exact distance-to-segment coverage.
 *
 * Coverage is combined with `max` rather than accumulated: ink is opaque, so
 * overlapping strokes must not read darker than a single stroke.
 */
function paintSegment(
  coverage: Float32Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
) {
  const reach = radius + 1;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - reach));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1) + reach));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - reach));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1) + reach));

  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      let t = lengthSquared > 0 ? ((px - x0) * dx + (py - y0) * dy) / lengthSquared : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const distanceX = px - (x0 + t * dx);
      const distanceY = py - (y0 + t * dy);
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
      const alpha = clamp01(radius + 0.5 - distance);
      const offset = y * size + x;
      if (alpha > coverage[offset]) {
        coverage[offset] = alpha;
      }
    }
  }
}

function paintDot(coverage: Float32Array, size: number, cx: number, cy: number, radius: number) {
  paintSegment(coverage, size, cx, cy, cx, cy, radius);
}

/**
 * Separable triangle-filter resample with the filter support scaled to the downscale
 * ratio. This is the kernel Pillow's `BILINEAR` uses when shrinking, which is what
 * best reproduces Google's published bitmaps.
 */
export function resampleTriangle(
  source: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const horizontal =
    sourceWidth === targetWidth
      ? source
      : resampleHorizontal(source, sourceWidth, sourceHeight, targetWidth);

  if (sourceHeight === targetHeight) {
    return horizontal === source ? Float32Array.from(source) : horizontal;
  }

  return resampleVertical(horizontal, targetWidth, sourceHeight, targetHeight);
}

/** Filter taps for one output position, or `null` when the window is empty. */
function triangleWeights(target: number, sourceSize: number, targetSize: number) {
  const ratio = sourceSize / targetSize;
  const support = Math.max(ratio, 1);
  const centre = (target + 0.5) * ratio;
  const start = Math.max(0, Math.ceil(centre - support - 0.5));
  const end = Math.min(sourceSize - 1, Math.floor(centre + support - 0.5));

  const weights: number[] = [];
  let total = 0;
  for (let index = start; index <= end; index += 1) {
    const weight = 1 - Math.abs((index + 0.5 - centre) / support);
    const clamped = weight > 0 ? weight : 0;
    weights.push(clamped);
    total += clamped;
  }

  return total > 0 ? { start, end, weights, total } : null;
}

function resampleHorizontal(
  source: Float32Array,
  sourceWidth: number,
  height: number,
  targetWidth: number,
) {
  const output = new Float32Array(targetWidth * height);
  for (let target = 0; target < targetWidth; target += 1) {
    const filter = triangleWeights(target, sourceWidth, targetWidth);
    if (!filter) {
      continue;
    }
    for (let y = 0; y < height; y += 1) {
      let total = 0;
      for (let index = filter.start; index <= filter.end; index += 1) {
        total += source[y * sourceWidth + index] * filter.weights[index - filter.start];
      }
      output[y * targetWidth + target] = total / filter.total;
    }
  }
  return output;
}

function resampleVertical(
  source: Float32Array,
  width: number,
  sourceHeight: number,
  targetHeight: number,
) {
  const output = new Float32Array(width * targetHeight);
  for (let target = 0; target < targetHeight; target += 1) {
    const filter = triangleWeights(target, sourceHeight, targetHeight);
    if (!filter) {
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      for (let index = filter.start; index <= filter.end; index += 1) {
        total += source[index * width + x] * filter.weights[index - filter.start];
      }
      output[target * width + x] = total / filter.total;
    }
  }
  return output;
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
