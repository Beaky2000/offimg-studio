/**
 * Generic error-diffusion engine. Every kernel in matrices.ts runs through this
 * one loop rather than getting its own hand-unrolled implementation.
 */
import type { DiffusionKernel } from './matrices.js';

export const THRESHOLD = 128;

/**
 * Rows of run-in dithered above the image, then thrown away.
 *
 * Error diffusion is causal: every tap has dy >= 0, and dy === 0 taps have
 * dx > 0, so error only ever flows to pixels not yet visited. Nothing reads from
 * above the image — which means the real first row starts with no incoming error
 * at all, and that shows.
 *
 * Within row 0 the only feedback is the single rightward tap (7/16 for
 * Floyd–Steinberg); the rest of the error is aimed at rows below, which row 0
 * never benefits from. So row 0 is a feedback loop of gain 7/16 whose fixed
 * point is (L - 0.4375*255) / 0.5625. For any uniform level above about 184 that
 * sits above the threshold, so row 0 cannot emit a single black pixel: a bright
 * flat image gets a solid white band across the top, several rows deep at high
 * levels.
 *
 * The fix is to give the diffusion a run-in. These extra rows replicate the
 * image's top row, are dithered normally so their error propagates downward, and
 * their output is discarded. The real row 0 then arrives with the incoming error
 * it would have had as a row in the middle of a taller image.
 *
 * Must stay EVEN: prepending an odd number of rows would flip the serpentine
 * parity of every real row.
 *
 * 48 was chosen by measurement, not guessed. The run-in has to be long enough for
 * the diffusion to reach its steady state, and that takes longer the brighter the
 * image, because error accumulates more slowly the smaller it is. Leading rows of
 * solid white on a uniform field, Floyd–Steinberg:
 *
 *   level | none |  8 | 16 | 32
 *     200 |    1 |  0 |  0 |  0
 *     230 |    2 |  0 |  0 |  0
 *     245 |    7 |  1 |  2 |  0
 *     250 |   14 |  6 |  5 |  0
 *
 * Worst case across all nine kernels and levels 5..252, which is dominated by the
 * near-white end, against cost for the heaviest kernel:
 *
 *   warm-up | worst leading rows | ms (Jarvis)
 *        32 |                 10 | 5.26
 *        48 |                  5 | 5.41
 *        64 |                  5 | 5.87
 *        96 |                  2 | 6.46
 *
 * 48 halves the worst case against 32 for about 3% more work; past that the curve
 * flattens and only the cost grows. A handful of rows still lack a black pixel at
 * levels above ~250, but there the steady state is only about five black pixels
 * per row anyway, so a row without one is barely distinguishable.
 *
 * Atkinson is excluded from those figures. It discards a quarter of the error by
 * design, so above roughly 215 it settles to solid white however long the run-in:
 * that is its documented character, not a run-in artefact.
 */
export const WARMUP_ROWS = 48;

/**
 * @param gray        one byte per pixel, row-major, top-down.
 * @param serpentine  Alternate scan direction per row. Straight left-to-right
 *                    scanning tends to drag error into diagonal streaks;
 *                    reversing every other row breaks them up.
 * @param warmupRows  Run-in rows above the image; see WARMUP_ROWS. Pass 0 to
 *                    dither the array exactly as given, which is what makes the
 *                    kernel arithmetic hand-checkable in tests.
 * @returns one byte per pixel, 0 or 255.
 */
export function ditherErrorDiffusion(
  gray: Uint8Array,
  width: number,
  height: number,
  kernel: DiffusionKernel,
  serpentine: boolean,
  out?: Uint8Array,
  warmupRows: number = WARMUP_ROWS,
): Uint8Array {
  const result = out && out.length === gray.length ? out : new Uint8Array(gray.length);

  const warmup = Math.max(0, warmupRows);
  const bufferRows = height + warmup;

  // Float working copy: accumulated error routinely pushes values outside
  // 0..255, and clamping it into a byte array would silently discard it.
  const buffer = new Float32Array(width * bufferRows);
  // Run-in rows replicate the top row of the image, i.e. the image is treated as
  // continuing unchanged above its edge.
  const topRow = gray.subarray(0, width);
  for (let y = 0; y < warmup; y++) buffer.set(topRow, y * width);
  buffer.set(gray, warmup * width);

  const tapCount = kernel.taps.length;
  const tapDx = new Int8Array(tapCount);
  const tapDy = new Int8Array(tapCount);
  const tapWeight = new Float32Array(tapCount);
  for (let t = 0; t < tapCount; t++) {
    const { dx, dy, w } = kernel.taps[t];
    tapDx[t] = dx;
    tapDy[t] = dy;
    tapWeight[t] = w / kernel.divisor;
  }

  for (let y = 0; y < bufferRows; y++) {
    const leftToRight = !serpentine || (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;
    const rowStart = y * width;
    // Negative while still warming up, so those rows propagate error but are
    // never written to the output.
    const outRow = y - warmup;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const index = rowStart + x;
      const value = buffer[index];
      const quantised = value >= THRESHOLD ? 255 : 0;
      if (outRow >= 0) result[outRow * width + x] = quantised;

      const error = value - quantised;
      if (error === 0) continue;

      for (let t = 0; t < tapCount; t++) {
        // Mirror the horizontal offsets when scanning right-to-left, so error
        // still travels in the direction of travel.
        const tx = x + (leftToRight ? tapDx[t] : -tapDx[t]);
        if (tx < 0 || tx >= width) continue;
        const ty = y + tapDy[t];
        if (ty >= bufferRows) continue; // dy is never negative
        buffer[ty * width + tx] += error * tapWeight[t];
      }
    }
  }

  return result;
}
