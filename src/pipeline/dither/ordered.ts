/**
 * Non-diffusing methods: plain threshold, random threshold, and ordered (Bayer)
 * dithering. All are point operations — each output pixel depends only on its
 * own input value and its position — so unlike error diffusion they are trivial
 * to parallelise and produce no smearing.
 */
import { THRESHOLD } from './errorDiffusion.js';

/** Hard threshold at 50%. Included as a baseline for comparison. */
export function ditherThreshold(gray: Uint8Array, out?: Uint8Array): Uint8Array {
  const result = out && out.length === gray.length ? out : new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) result[i] = gray[i] >= THRESHOLD ? 255 : 0;
  return result;
}

/**
 * xorshift32. A seeded generator, not Math.random, and deliberately so: the
 * preview recomputes on every slider move, and an unseeded generator would make
 * the image crawl whenever an unrelated control was touched — and would produce
 * a saved file that differed from what was on screen.
 */
function xorshift32(seed: number): () => number {
  let state = seed | 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function ditherRandom(gray: Uint8Array, seed: number, out?: Uint8Array): Uint8Array {
  const result = out && out.length === gray.length ? out : new Uint8Array(gray.length);
  const random = xorshift32(seed);
  for (let i = 0; i < gray.length; i++) {
    // Scaling by 255 rather than 256 puts the threshold in the open range
    // (0, 255): pure white always stays white and pure black always stays
    // black, and P(white) works out to exactly v/255 in between. Scaling by
    // 256 would let a threshold above 255 turn a white pixel black.
    result[i] = gray[i] >= random() * 255 ? 255 : 0;
  }
  return result;
}

/** Standard recursively-generated Bayer matrices. */
export const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/**
 * Build the per-cell threshold table. The +0.5 centres each threshold inside
 * its slot, which is what keeps pure black (0) and pure white (255) from
 * dithering: the lowest threshold lands just above 0 and the highest just below
 * 255.
 */
function thresholdsFor(matrix: number[][]): Float32Array {
  const size = matrix.length;
  const levels = size * size;
  const table = new Float32Array(levels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      table[y * size + x] = ((matrix[y][x] + 0.5) / levels) * 255;
    }
  }
  return table;
}

const BAYER_4_THRESHOLDS = thresholdsFor(BAYER_4);
const BAYER_8_THRESHOLDS = thresholdsFor(BAYER_8);

export function ditherBayer(
  gray: Uint8Array,
  width: number,
  size: 4 | 8,
  out?: Uint8Array,
): Uint8Array {
  const result = out && out.length === gray.length ? out : new Uint8Array(gray.length);
  const thresholds = size === 4 ? BAYER_4_THRESHOLDS : BAYER_8_THRESHOLDS;
  const mask = size - 1; // size is a power of two, so & replaces %

  for (let i = 0; i < gray.length; i++) {
    const x = i % width;
    const y = (i / width) | 0;
    result[i] = gray[i] >= thresholds[(y & mask) * size + (x & mask)] ? 255 : 0;
  }
  return result;
}
