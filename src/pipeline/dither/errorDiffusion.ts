/**
 * Generic error-diffusion engine. Every kernel in matrices.ts runs through this
 * one loop rather than getting its own hand-unrolled implementation.
 */
import type { DiffusionKernel } from './matrices.js';

export const THRESHOLD = 128;

/**
 * @param gray       one byte per pixel, row-major, top-down.
 * @param serpentine Alternate scan direction per row. Straight left-to-right
 *                   scanning tends to drag error into diagonal streaks;
 *                   reversing every other row breaks them up.
 * @returns one byte per pixel, 0 or 255.
 */
export function ditherErrorDiffusion(
  gray: Uint8Array,
  width: number,
  height: number,
  kernel: DiffusionKernel,
  serpentine: boolean,
  out?: Uint8Array,
): Uint8Array {
  const result = out && out.length === gray.length ? out : new Uint8Array(gray.length);

  // Float working copy: accumulated error routinely pushes values outside
  // 0..255, and clamping it into a byte array would silently discard it.
  const buffer = new Float32Array(gray);

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

  for (let y = 0; y < height; y++) {
    const leftToRight = !serpentine || (y & 1) === 0;
    const xStart = leftToRight ? 0 : width - 1;
    const xEnd = leftToRight ? width : -1;
    const xStep = leftToRight ? 1 : -1;
    const rowStart = y * width;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const index = rowStart + x;
      const value = buffer[index];
      const quantised = value >= THRESHOLD ? 255 : 0;
      result[index] = quantised;

      const error = value - quantised;
      if (error === 0) continue;

      for (let t = 0; t < tapCount; t++) {
        // Mirror the horizontal offsets when scanning right-to-left, so error
        // still travels in the direction of travel.
        const tx = x + (leftToRight ? tapDx[t] : -tapDx[t]);
        if (tx < 0 || tx >= width) continue;
        const ty = y + tapDy[t];
        if (ty >= height) continue; // dy is never negative
        buffer[ty * width + tx] += error * tapWeight[t];
      }
    }
  }

  return result;
}
