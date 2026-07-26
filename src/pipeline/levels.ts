/**
 * Stage 3: black point, white point, and contrast.
 *
 * Everything is expressed as a 256-entry lookup table, so moving a slider costs
 * 256 operations to rebuild the table plus one indexed read per pixel. That is
 * what keeps the dithered preview live while dragging.
 */

export interface LevelSettings {
  /** Input value mapped to 0; anything below is clamped to black. */
  blackPoint: number;
  /** Input value mapped to 255; anything above is clamped to white. */
  whitePoint: number;
  /** -100..+100. 0 is a straight line. */
  contrast: number;
}

export const DEFAULT_LEVELS: LevelSettings = { blackPoint: 0, whitePoint: 255, contrast: 0 };

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
  const span = white - black;
  for (let v = 0; v < 256; v++) {
    const t = Math.min(Math.max((v - black) / span, 0), 1);
    lut[v] = Math.round(255 * gain(t, k));
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
