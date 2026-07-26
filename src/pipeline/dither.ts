/**
 * Stage 4: reduce 8-bit gray to 1 bit.
 *
 * Inversion is applied here rather than in the BMP encoder so that the preview
 * shows exactly the bits that get written to disk.
 */
import { ditherErrorDiffusion } from './dither/errorDiffusion.js';
import { DIFFUSION_KERNELS, type DiffusionKernelId } from './dither/matrices.js';
import { ditherBayer, ditherRandom, ditherThreshold } from './dither/ordered.js';

export type DitherId = DiffusionKernelId | 'threshold' | 'random' | 'bayer-4' | 'bayer-8';

export interface DitherSettings {
  algorithm: DitherId;
  serpentine: boolean;
  invert: boolean;
  seed: number;
}

export const DEFAULT_DITHER: DitherSettings = {
  algorithm: 'floyd-steinberg',
  serpentine: true,
  invert: false,
  seed: 1,
};

export interface DitherOption {
  id: DitherId;
  label: string;
  group: 'Error diffusion' | 'Ordered and simple';
  /** Whether the serpentine control has any effect on this algorithm. */
  usesSerpentine: boolean;
  /** Whether the seed control has any effect. */
  usesSeed: boolean;
}

export const DITHER_OPTIONS: DitherOption[] = [
  ...(Object.entries(DIFFUSION_KERNELS) as Array<
    [DiffusionKernelId, (typeof DIFFUSION_KERNELS)[DiffusionKernelId]]
  >).map(([id, kernel]): DitherOption => ({
    id,
    label: kernel.label,
    group: 'Error diffusion',
    usesSerpentine: true,
    usesSeed: false,
  })),
  { id: 'bayer-4', label: 'Bayer 4×4', group: 'Ordered and simple', usesSerpentine: false, usesSeed: false },
  { id: 'bayer-8', label: 'Bayer 8×8', group: 'Ordered and simple', usesSerpentine: false, usesSeed: false },
  { id: 'random', label: 'Random', group: 'Ordered and simple', usesSerpentine: false, usesSeed: true },
  { id: 'threshold', label: 'Threshold (no dither)', group: 'Ordered and simple', usesSerpentine: false, usesSeed: false },
];

export function findDitherOption(id: DitherId): DitherOption {
  const option = DITHER_OPTIONS.find((o) => o.id === id);
  if (!option) throw new Error(`Unknown dither algorithm: ${id}`);
  return option;
}

/** @returns one byte per pixel, 0 or 255. */
export function dither(
  gray: Uint8Array,
  width: number,
  height: number,
  settings: DitherSettings,
  out?: Uint8Array,
): Uint8Array {
  let result: Uint8Array;

  switch (settings.algorithm) {
    case 'threshold':
      result = ditherThreshold(gray, out);
      break;
    case 'random':
      result = ditherRandom(gray, settings.seed, out);
      break;
    case 'bayer-4':
      result = ditherBayer(gray, width, 4, out);
      break;
    case 'bayer-8':
      result = ditherBayer(gray, width, 8, out);
      break;
    default:
      result = ditherErrorDiffusion(
        gray,
        width,
        height,
        DIFFUSION_KERNELS[settings.algorithm],
        settings.serpentine,
        out,
      );
      break;
  }

  if (settings.invert) {
    for (let i = 0; i < result.length; i++) result[i] = 255 - result[i];
  }

  return result;
}
