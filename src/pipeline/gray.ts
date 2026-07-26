/**
 * Stage 2: RGB -> grayscale using linear intensity.
 *
 * The naive approach (0.2126*R + 0.7152*G + 0.0722*B applied straight to the
 * stored 8-bit values) averages gamma-encoded numbers, which is not what light
 * does. Mixing must happen in linear light: decode gamma, take the weighted
 * sum, re-encode. Saturated colours in particular come out visibly different.
 *
 * Reference: https://entropymine.com/imageworsener/grayscale/
 *
 * There are no user options here in this version; a future "transfer function"
 * or colour-filter control would slot in around DISPLAY_GAMMA and the weights.
 */

/**
 * The article uses a plain 2.2 power law. The exact sRGB curve is piecewise
 * (a linear segment near black, then (c+0.055)/1.055 raised to 2.4) and differs
 * from this by well under one 8-bit step outside the deep shadows — immaterial
 * once the result is reduced to one bit. Kept as a single constant so swapping
 * in the piecewise form later is a local change.
 */
export const DISPLAY_GAMMA = 2.2;

/** Rec.709 / sRGB luminance weights. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/** 8-bit sRGB value -> linear intensity in 0..1. */
const DECODE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  DECODE[i] = Math.pow(i / 255, DISPLAY_GAMMA);
}

const ENCODE_EXPONENT = 1 / DISPLAY_GAMMA;

/**
 * @param rgba  width*height*4 bytes, alpha ignored (stage 1 guarantees opaque).
 * @param out   optional buffer to reuse, avoiding a per-frame allocation.
 * @returns one byte per pixel, gamma-encoded gray.
 */
export function toGrayscale(rgba: Uint8ClampedArray, out?: Uint8Array): Uint8Array {
  const pixels = rgba.length >> 2;
  const gray = out && out.length === pixels ? out : new Uint8Array(pixels);

  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    const linear = LUMA_R * DECODE[rgba[p]] + LUMA_G * DECODE[rgba[p + 1]] + LUMA_B * DECODE[rgba[p + 2]];
    gray[i] = Math.round(255 * Math.pow(linear, ENCODE_EXPONENT));
  }

  return gray;
}

/** Expand one-byte-per-pixel gray into RGBA for canvas display. */
export function grayToRgba(gray: Uint8Array, out?: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = out && out.length === gray.length * 4 ? out : new Uint8ClampedArray(gray.length * 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i];
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
    rgba[p + 3] = 255;
  }
  return rgba;
}
