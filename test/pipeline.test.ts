import { describe, expect, it } from 'vitest';
import { OFFIMG_HEIGHT, OFFIMG_WIDTH } from '../src/io/bmp1.js';
import {
  DITHER_OPTIONS,
  dither,
  type DitherId,
  type DitherSettings,
} from '../src/pipeline/dither.js';
import { aspectMatchesTarget, computeDrawRect } from '../src/pipeline/frame.js';
import { toGrayscale } from '../src/pipeline/gray.js';
import {
  DEFAULT_LEVELS,
  applyLut,
  buildLevelsLut,
  contrastToExponent,
  gain,
} from '../src/pipeline/levels.js';

// --- Stage 1: framing ------------------------------------------------------

describe('aspectMatchesTarget', () => {
  it('accepts exact 5:3', () => {
    expect(aspectMatchesTarget(400, 240)).toBe(true);
    expect(aspectMatchesTarget(800, 480)).toBe(true);
    expect(aspectMatchesTarget(1000, 600)).toBe(true);
  });

  it('accepts a source a couple of pixels off from a resize', () => {
    expect(aspectMatchesTarget(801, 480)).toBe(true); // 0.13% off
  });

  it('rejects a genuine mismatch', () => {
    expect(aspectMatchesTarget(810, 480)).toBe(false); // 1.25% off
    expect(aspectMatchesTarget(1920, 1080)).toBe(false); // 16:9
    expect(aspectMatchesTarget(1000, 1000)).toBe(false);
  });

  it('rejects degenerate sizes', () => {
    expect(aspectMatchesTarget(0, 240)).toBe(false);
    expect(aspectMatchesTarget(400, 0)).toBe(false);
  });
});

describe('computeDrawRect', () => {
  it('maps an exact-aspect source straight onto the frame', () => {
    for (const mode of ['fill', 'fit-white', 'fit-black'] as const) {
      expect(computeDrawRect(800, 480, { mode, cropPos: 50 })).toEqual({
        dx: 0,
        dy: 0,
        dw: OFFIMG_WIDTH,
        dh: OFFIMG_HEIGHT,
      });
    }
  });

  it('crops left/right for a too-wide source, steered by cropPos', () => {
    // 1000x500 (2:1) covered => 480x240, so 80px overflows horizontally.
    const at = (cropPos: number) => computeDrawRect(1000, 500, { mode: 'fill', cropPos });
    expect(at(0)).toEqual({ dx: 0, dy: 0, dw: 480, dh: 240 });
    expect(at(50)).toEqual({ dx: -40, dy: 0, dw: 480, dh: 240 });
    expect(at(100)).toEqual({ dx: -80, dy: 0, dw: 480, dh: 240 });
  });

  it('crops top/bottom for a too-tall source', () => {
    // 500x1000 covered => 400x800, so 560px overflows vertically.
    const at = (cropPos: number) => computeDrawRect(500, 1000, { mode: 'fill', cropPos });
    expect(at(0)).toEqual({ dx: 0, dy: 0, dw: 400, dh: 800 });
    expect(at(100)).toEqual({ dx: 0, dy: -560, dw: 400, dh: 800 });
  });

  it('clamps cropPos to 0..100', () => {
    expect(computeDrawRect(1000, 500, { mode: 'fill', cropPos: -50 }).dx).toBe(0);
    expect(computeDrawRect(1000, 500, { mode: 'fill', cropPos: 500 }).dx).toBe(-80);
  });

  it('centres a fitted source inside the frame', () => {
    // 1000x500 contained => 400x200, leaving 20px bars top and bottom.
    expect(computeDrawRect(1000, 500, { mode: 'fit-white', cropPos: 0 })).toEqual({
      dx: 0,
      dy: 20,
      dw: 400,
      dh: 200,
    });
    // 500x1000 contained => 120x240, leaving 140px bars left and right.
    expect(computeDrawRect(500, 1000, { mode: 'fit-black', cropPos: 0 })).toEqual({
      dx: 140,
      dy: 0,
      dw: 120,
      dh: 240,
    });
  });

  it('upscales a source smaller than the frame', () => {
    expect(computeDrawRect(200, 120, { mode: 'fill', cropPos: 50 })).toEqual({
      dx: 0,
      dy: 0,
      dw: 400,
      dh: 240,
    });
  });
});

// --- Stage 2: grayscale ----------------------------------------------------

function grayOf(r: number, g: number, b: number, a = 255): number {
  return toGrayscale(new Uint8ClampedArray([r, g, b, a]))[0];
}

describe('toGrayscale', () => {
  it('preserves black and white', () => {
    expect(grayOf(0, 0, 0)).toBe(0);
    expect(grayOf(255, 255, 255)).toBe(255);
  });

  it('leaves neutral grays unchanged', () => {
    // The weights sum to exactly 1, so decode-mix-encode is a round trip for
    // any R=G=B input.
    for (const v of [1, 17, 64, 128, 200, 254]) {
      expect(grayOf(v, v, v)).toBe(v);
    }
  });

  it('mixes in linear light, not on gamma-encoded values', () => {
    // This is the whole point of the stage. A naive weighted average of the
    // stored bytes would give 54 / 182 / 18 for the primaries; mixing in
    // linear light and re-encoding gives markedly lighter results.
    expect(grayOf(255, 0, 0)).toBeCloseTo(126, 0);
    expect(grayOf(0, 255, 0)).toBeCloseTo(219, 0);
    expect(grayOf(0, 0, 255)).toBeCloseTo(77, 0);
  });

  it('ignores alpha', () => {
    expect(grayOf(128, 128, 128, 0)).toBe(grayOf(128, 128, 128, 255));
  });

  it('reuses a supplied output buffer', () => {
    const rgba = new Uint8ClampedArray(4 * 3);
    const out = new Uint8Array(3);
    expect(toGrayscale(rgba, out)).toBe(out);
  });
});

// --- Stage 3: levels -------------------------------------------------------

describe('gain', () => {
  it('is the identity at k = 1', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1]) expect(gain(t, 1)).toBe(t);
  });

  it('pins both endpoints and the midpoint for any k', () => {
    for (const k of [0.25, 0.5, 1, 2, 4]) {
      expect(gain(0, k)).toBe(0);
      expect(gain(1, k)).toBe(1);
      expect(gain(0.5, k)).toBeCloseTo(0.5, 10);
    }
  });

  it('steepens the middle for k > 1 and flattens it for k < 1', () => {
    expect(gain(0.25, 4)).toBeLessThan(0.25);
    expect(gain(0.75, 4)).toBeGreaterThan(0.75);
    expect(gain(0.25, 0.25)).toBeGreaterThan(0.25);
    expect(gain(0.75, 0.25)).toBeLessThan(0.75);
  });
});

describe('contrastToExponent', () => {
  it('maps 0 to exactly 1 so the default is a true no-op', () => {
    expect(contrastToExponent(0)).toBe(1);
  });

  it('is geometric and symmetric', () => {
    expect(contrastToExponent(100)).toBeCloseTo(4, 10);
    expect(contrastToExponent(-100)).toBeCloseTo(0.25, 10);
    expect(contrastToExponent(50) * contrastToExponent(-50)).toBeCloseTo(1, 10);
  });
});

describe('buildLevelsLut', () => {
  it('is the identity at default settings', () => {
    const lut = buildLevelsLut(DEFAULT_LEVELS);
    for (let v = 0; v < 256; v++) expect(lut[v]).toBe(v);
  });

  it('clamps below the black point and above the white point', () => {
    const lut = buildLevelsLut({ blackPoint: 64, whitePoint: 192, contrast: 0 });
    for (let v = 0; v <= 64; v++) expect(lut[v]).toBe(0);
    for (let v = 192; v < 256; v++) expect(lut[v]).toBe(255);
    expect(lut[128]).toBe(128); // exactly midway between the points -> 127.5, rounded up
  });

  it('stays monotonic across the contrast range', () => {
    for (const contrast of [-100, -50, 0, 50, 100]) {
      const lut = buildLevelsLut({ blackPoint: 20, whitePoint: 230, contrast });
      for (let v = 1; v < 256; v++) expect(lut[v]).toBeGreaterThanOrEqual(lut[v - 1]);
    }
  });

  it('keeps the endpoints fixed when contrast is applied', () => {
    for (const contrast of [-100, 100]) {
      const lut = buildLevelsLut({ blackPoint: 40, whitePoint: 210, contrast });
      expect(lut[40]).toBe(0);
      expect(lut[210]).toBe(255);
    }
  });

  it('collapses to a hard threshold if the range is degenerate', () => {
    const lut = buildLevelsLut({ blackPoint: 100, whitePoint: 100, contrast: 0 });
    expect(lut[99]).toBe(0);
    expect(lut[100]).toBe(255);
    // Inverted input must not produce NaN or a wrapped byte.
    const inverted = buildLevelsLut({ blackPoint: 200, whitePoint: 50, contrast: 0 });
    expect([...inverted].every((v) => v === 0 || v === 255)).toBe(true);
  });
});

describe('applyLut', () => {
  it('maps every pixel through the table', () => {
    const lut = buildLevelsLut({ blackPoint: 0, whitePoint: 255, contrast: 0 });
    const gray = new Uint8Array([0, 50, 128, 255]);
    expect([...applyLut(gray, lut)]).toEqual([0, 50, 128, 255]);
  });

  it('reuses a supplied output buffer', () => {
    const out = new Uint8Array(4);
    expect(applyLut(new Uint8Array(4), buildLevelsLut(DEFAULT_LEVELS), out)).toBe(out);
  });
});

// --- Stage 4: dithering ----------------------------------------------------

const ALL_IDS = DITHER_OPTIONS.map((o) => o.id);

function settings(overrides: Partial<DitherSettings> = {}): DitherSettings {
  return { algorithm: 'floyd-steinberg', serpentine: false, invert: false, seed: 1, ...overrides };
}

function filled(value: number, width = 64, height = 64): Uint8Array {
  return new Uint8Array(width * height).fill(value);
}

describe('dither', () => {
  it('covers every algorithm offered in the UI', () => {
    expect(ALL_IDS).toHaveLength(13);
    expect(new Set(ALL_IDS).size).toBe(13);
  });

  it.each(ALL_IDS)('leaves a pure black field black (%s)', (algorithm) => {
    const out = dither(filled(0), 64, 64, settings({ algorithm }));
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it.each(ALL_IDS)('leaves a pure white field white (%s)', (algorithm) => {
    const out = dither(filled(255), 64, 64, settings({ algorithm }));
    expect(out.every((v) => v === 255)).toBe(true);
  });

  it.each(ALL_IDS)('only ever emits 0 or 255 (%s)', (algorithm) => {
    let seed = 7;
    const gray = new Uint8Array(64 * 64);
    for (let i = 0; i < gray.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      gray[i] = (seed >>> 8) & 0xff;
    }
    const out = dither(gray, 64, 64, settings({ algorithm }));
    expect(out.every((v) => v === 0 || v === 255)).toBe(true);
  });

  it('thresholds at 128', () => {
    const gray = new Uint8Array([0, 127, 128, 255]);
    const out = dither(gray, 4, 1, settings({ algorithm: 'threshold' }));
    expect([...out]).toEqual([0, 0, 255, 255]);
  });

  it('matches a hand-computed Floyd–Steinberg step', () => {
    // Two pixels at 128. The first quantises up to 255, leaving an error of
    // -127; 7/16 of that (-55.5625) lands on the second pixel, taking it to
    // 72.4375, which is below the threshold.
    const out = dither(new Uint8Array([128, 128]), 2, 1, settings());
    expect([...out]).toEqual([255, 0]);
  });

  const MEAN_PRESERVING: DitherId[] = [
    'floyd-steinberg',
    'jarvis',
    'stucki',
    'burkes',
    'sierra-3',
    'sierra-2',
    'sierra-lite',
  ];

  it.each(MEAN_PRESERVING)('preserves average brightness (%s)', (algorithm) => {
    // The defining property of error diffusion: nothing is thrown away, so a
    // flat field comes back with the same mean. Atkinson and False
    // Floyd-Steinberg are excluded because they discard error by design.
    for (const level of [64, 128, 190]) {
      const out = dither(filled(level, 128, 128), 128, 128, settings({ algorithm }));
      const mean = out.reduce((sum, v) => sum + v, 0) / out.length;
      expect(Math.abs(mean - level)).toBeLessThan(5);
    }
  });

  it('produces a mid-gray field as a mix, not a flat block', () => {
    for (const algorithm of ALL_IDS) {
      const out = dither(filled(128), 64, 64, settings({ algorithm }));
      const white = out.reduce((n, v) => n + (v === 255 ? 1 : 0), 0);
      // 'threshold' is the deliberate exception: 128 is exactly at its cut.
      if (algorithm === 'threshold') {
        expect(white).toBe(out.length);
      } else {
        expect(white).toBeGreaterThan(0);
        expect(white).toBeLessThan(out.length);
      }
    }
  });

  it('changes the result when serpentine scanning is toggled', () => {
    const gray = filled(100);
    const straight = dither(gray, 64, 64, settings({ serpentine: false }));
    const snake = dither(gray, 64, 64, settings({ serpentine: true }));
    expect([...snake]).not.toEqual([...straight]);
  });

  it('is deterministic for random dither, and seed-dependent', () => {
    const gray = filled(128);
    const a = dither(gray, 64, 64, settings({ algorithm: 'random', seed: 42 }));
    const b = dither(gray, 64, 64, settings({ algorithm: 'random', seed: 42 }));
    const c = dither(gray, 64, 64, settings({ algorithm: 'random', seed: 43 }));
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  it('inverts the output when asked', () => {
    const gray = filled(100);
    const normal = dither(gray, 64, 64, settings());
    const inverted = dither(gray, 64, 64, settings({ invert: true }));
    for (let i = 0; i < normal.length; i++) expect(inverted[i]).toBe(255 - normal[i]);
  });

  it('tiles Bayer thresholds over the full frame', () => {
    const out = dither(filled(128, OFFIMG_WIDTH, OFFIMG_HEIGHT), OFFIMG_WIDTH, OFFIMG_HEIGHT, settings({ algorithm: 'bayer-8' }));
    // 400 and 240 are both multiples of 8, so a flat field gives exactly half
    // white pixels: proof the matrix indexing wraps on both axes.
    const white = out.reduce((n, v) => n + (v === 255 ? 1 : 0), 0);
    expect(white).toBe(out.length / 2);
  });

  it('reuses a supplied output buffer', () => {
    const out = new Uint8Array(64 * 64);
    expect(dither(filled(100), 64, 64, settings(), out)).toBe(out);
  });
});
