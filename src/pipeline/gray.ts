/**
 * Stage 2: RGB -> grayscale using linear intensity, with an adjustable colour
 * filter.
 *
 * The naive approach (weights applied straight to the stored 8-bit values)
 * averages gamma-encoded numbers, which is not what light does. Mixing must
 * happen in linear light: decode gamma, take the weighted sum, re-encode.
 * Saturated colours in particular come out visibly different.
 *
 * Reference: https://entropymine.com/imageworsener/grayscale/
 *
 * The channel weights are exposed as a colour filter. Raising one channel makes
 * objects of that colour lighter, which is the classic photographic trick of
 * shooting black-and-white through a coloured filter — a red filter darkens a
 * blue sky, and so on. Useful here because separating two colours of similar
 * luminance is otherwise impossible once the image is down to one bit.
 */

/**
 * Weights are held as integers summing to WEIGHT_SCALE rather than as fractions.
 *
 * The constraint is that the three must always total exactly 1.0: with floats,
 * repeatedly redistributing the remainder would accumulate rounding error and
 * drift off 1.0, changing overall image brightness as a side effect of moving a
 * slider. Integers make the sum exact by construction. 10000 also happens to
 * represent the Rec.709 defaults exactly — 2126 + 7152 + 722 = 10000 — so the
 * default mix is bit-identical to using the 0.2126/0.7152/0.0722 literals.
 */
export const WEIGHT_SCALE = 10_000;

export interface ChannelMix {
  r: number;
  g: number;
  b: number;
}

export type ChannelName = keyof ChannelMix;

export const CHANNEL_NAMES: readonly ChannelName[] = ['r', 'g', 'b'];

/** Rec.709 / sRGB luminance weights, scaled by WEIGHT_SCALE. */
export const DEFAULT_MIX: ChannelMix = { r: 2126, g: 7152, b: 722 };

/**
 * The article uses a plain 2.2 power law. The exact sRGB curve is piecewise
 * (a linear segment near black, then (c+0.055)/1.055 raised to 2.4) and differs
 * from this by well under one 8-bit step outside the deep shadows — immaterial
 * once the result is reduced to one bit. Kept as a single constant so swapping
 * in the piecewise form later is a local change.
 */
export const DISPLAY_GAMMA = 2.2;

/** 8-bit sRGB value -> linear intensity in 0..1. */
const DECODE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  DECODE[i] = Math.pow(i / 255, DISPLAY_GAMMA);
}

const ENCODE_EXPONENT = 1 / DISPLAY_GAMMA;

/**
 * Set one channel's weight and absorb the difference into the other two, so the
 * three always sum to WEIGHT_SCALE.
 *
 * The remainder is split between the other two channels *in proportion to their
 * current values*, which keeps their relative balance intact — nudging red
 * should not also change how green and blue compare to each other. The second
 * channel takes whatever is left rather than being rounded independently, which
 * is what makes the total exact.
 */
export function setMixChannel(
  mix: ChannelMix,
  channel: ChannelName,
  value: number,
): ChannelMix {
  const target = Math.min(Math.max(Math.round(value), 0), WEIGHT_SCALE);
  const [a, b] = CHANNEL_NAMES.filter((c) => c !== channel) as [ChannelName, ChannelName];

  const remainder = WEIGHT_SCALE - target;
  const othersTotal = mix[a] + mix[b];

  let aValue: number;
  if (othersTotal > 0) {
    aValue = Math.round((remainder * mix[a]) / othersTotal);
  } else {
    // Both other channels are at zero, so there is no ratio to preserve; an
    // even split is the only neutral choice.
    aValue = Math.floor(remainder / 2);
  }

  const next: ChannelMix = { r: mix.r, g: mix.g, b: mix.b };
  next[channel] = target;
  next[a] = aValue;
  next[b] = remainder - aValue;
  return next;
}

/** Weight as a 0..1 fraction, for display and for the mixing maths. */
export function mixFraction(weight: number): number {
  return weight / WEIGHT_SCALE;
}

/**
 * @param rgba  width*height*4 bytes, alpha ignored (stage 1 guarantees opaque).
 * @param mix   channel weights; must sum to WEIGHT_SCALE.
 * @param out   optional buffer to reuse, avoiding a per-frame allocation.
 * @returns one byte per pixel, gamma-encoded gray.
 */
export function toGrayscale(
  rgba: Uint8ClampedArray,
  mix: ChannelMix = DEFAULT_MIX,
  out?: Uint8Array,
): Uint8Array {
  const pixels = rgba.length >> 2;
  const gray = out && out.length === pixels ? out : new Uint8Array(pixels);

  const wr = mixFraction(mix.r);
  const wg = mixFraction(mix.g);
  const wb = mixFraction(mix.b);

  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    const linear = wr * DECODE[rgba[p]] + wg * DECODE[rgba[p + 1]] + wb * DECODE[rgba[p + 2]];
    gray[i] = Math.round(255 * Math.pow(linear, ENCODE_EXPONENT));
  }

  return gray;
}
