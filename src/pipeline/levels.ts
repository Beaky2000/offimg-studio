/**
 * Stage 3: black point, white point, contrast, and brightness.
 *
 * Everything is expressed as a 256-entry lookup table, so moving a slider costs
 * 256 operations to rebuild the table plus one indexed read per pixel. That is
 * what keeps the dithered preview live while dragging.
 *
 * The four controls compose in this order:
 *
 *   stretch (black/white point) -> S-curve (contrast) -> gamma (brightness)
 *
 * Gamma is applied *last*, deliberately. `gain` pivots about 0.5, so putting
 * gamma first would move the midtone away from that pivot and the contrast curve
 * would then amplify the shift — brightness would get stronger as contrast rose.
 * Applying gamma afterwards means the midtone lands exactly where the brightness
 * slider says regardless of the contrast setting, so the two controls stay
 * independent. Every step pins 0 and 1, so neither can disturb the black or
 * white point.
 */

export interface LevelSettings {
  /** Input value mapped to 0; anything below is clamped to black. */
  blackPoint: number;
  /** Input value mapped to 255; anything above is clamped to white. */
  whitePoint: number;
  /** -100..+100. 0 is a straight line. */
  contrast: number;
  /** -100..+100, mapped geometrically to a gamma exponent. 0 means gamma 1.0. */
  brightness: number;
}

export const DEFAULT_LEVELS: LevelSettings = {
  blackPoint: 0,
  whitePoint: 255,
  contrast: 0,
  brightness: 0,
};

/**
 * Contrast slider -> exponent for `gain`.
 *
 * 0 gives exactly 1 (identity), +-100 gives 4 and 1/4, and the mapping is
 * geometric so equal slider movements feel equally strong in both directions.
 */
export function contrastToExponent(contrast: number): number {
  return Math.pow(2, contrast / 50);
}

/**
 * Symmetric S-curve on 0..1, after Inigo Quilez's "gain".
 *
 * k = 1 is the identity, k > 1 steepens the middle (more contrast), k < 1
 * flattens it. It is monotonic and pins both 0 and 1 exactly, so raising
 * contrast can never shift the black or white point the user just set.
 */
export function gain(t: number, k: number): number {
  if (k === 1) return t;
  return t < 0.5 ? 0.5 * Math.pow(2 * t, k) : 1 - 0.5 * Math.pow(2 - 2 * t, k);
}

/**
 * Brightness slider -> gamma exponent.
 *
 * 0 gives exactly 1.0, a neutral linear response. Positive values give gamma
 * above 1, which lifts the midtones; negative values darken them. Same geometric
 * mapping as contrast, so +-100 gives 4.0 and 0.25 and equal slider movements
 * feel equally strong either way.
 */
export function brightnessToGamma(brightness: number): number {
  return Math.pow(2, brightness / 50);
}

/**
 * Apply a gamma curve to a normalised 0..1 value.
 *
 * The exponent is 1/gamma, which is the usual convention: gamma > 1 brightens.
 * 0 and 1 are fixed points for any exponent.
 */
export function applyGamma(t: number, gamma: number): number {
  if (gamma === 1) return t;
  return Math.pow(t, 1 / gamma);
}

/** Build the 256-entry input -> output mapping for the current settings. */
export function buildLevelsLut(settings: LevelSettings): Uint8Array {
  const lut = new Uint8Array(256);
  const black = clamp255(settings.blackPoint);
  const white = clamp255(settings.whitePoint);

  // Degenerate range has no interior to map, so it collapses to a hard
  // threshold. The UI prevents this, but a LUT with a zero-width domain would
  // otherwise divide by zero.
  if (white <= black) {
    for (let v = 0; v < 256; v++) lut[v] = v >= black ? 255 : 0;
    return lut;
  }

  const k = contrastToExponent(settings.contrast);
  const gamma = brightnessToGamma(settings.brightness);
  const span = white - black;
  for (let v = 0; v < 256; v++) {
    const t = Math.min(Math.max((v - black) / span, 0), 1);
    lut[v] = Math.round(255 * applyGamma(gain(t, k), gamma));
  }
  return lut;
}

export function applyLut(gray: Uint8Array, lut: Uint8Array, out?: Uint8Array): Uint8Array {
  const result = out && out.length === gray.length ? out : new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) result[i] = lut[gray[i]];
  return result;
}

function clamp255(v: number): number {
  return Math.min(Math.max(Math.round(v), 0), 255);
}
