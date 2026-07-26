/**
 * Error-diffusion kernels, transcribed from Tanner Helland's survey:
 * https://tannerhelland.com/2012/12/28/dithering-eleven-algorithms-source-code.html
 *
 * Each tap is an offset from the pixel being quantised plus an integer weight;
 * the fraction of the error it receives is `w / divisor`. `dy` is never
 * negative and taps with `dy === 0` always have positive `dx`, because error
 * may only ever flow to pixels not yet visited.
 *
 * Note that Atkinson's weights sum to 6 against a divisor of 8: it deliberately
 * discards a quarter of the error, which is what gives it its clean, open look
 * on high-contrast material. The generic engine needs no special case for it.
 */

export interface DiffusionTap {
  dx: number;
  dy: number;
  w: number;
}

export interface DiffusionKernel {
  label: string;
  divisor: number;
  taps: DiffusionTap[];
}

const tap = (dx: number, dy: number, w: number): DiffusionTap => ({ dx, dy, w });

export const DIFFUSION_KERNELS = {
  /*       X 7
     3 5 1        / 16  */
  'floyd-steinberg': {
    label: 'Floyd–Steinberg',
    divisor: 16,
    taps: [tap(1, 0, 7), tap(-1, 1, 3), tap(0, 1, 5), tap(1, 1, 1)],
  },

  /*   X 3
       3 2        / 8   */
  'false-floyd-steinberg': {
    label: 'False Floyd–Steinberg',
    divisor: 8,
    taps: [tap(1, 0, 3), tap(0, 1, 3), tap(1, 1, 2)],
  },

  /*         X 7 5
     3 5 7 5 3
     1 3 5 3 1    / 48  */
  jarvis: {
    label: 'Jarvis–Judice–Ninke',
    divisor: 48,
    taps: [
      tap(1, 0, 7), tap(2, 0, 5),
      tap(-2, 1, 3), tap(-1, 1, 5), tap(0, 1, 7), tap(1, 1, 5), tap(2, 1, 3),
      tap(-2, 2, 1), tap(-1, 2, 3), tap(0, 2, 5), tap(1, 2, 3), tap(2, 2, 1),
    ],
  },

  /*         X 8 4
     2 4 8 4 2
     1 2 4 2 1    / 42  */
  stucki: {
    label: 'Stucki',
    divisor: 42,
    taps: [
      tap(1, 0, 8), tap(2, 0, 4),
      tap(-2, 1, 2), tap(-1, 1, 4), tap(0, 1, 8), tap(1, 1, 4), tap(2, 1, 2),
      tap(-2, 2, 1), tap(-1, 2, 2), tap(0, 2, 4), tap(1, 2, 2), tap(2, 2, 1),
    ],
  },

  /*       X 1 1
     1 1 1
       1          / 8, weights sum to 6 by design */
  atkinson: {
    label: 'Atkinson',
    divisor: 8,
    taps: [
      tap(1, 0, 1), tap(2, 0, 1),
      tap(-1, 1, 1), tap(0, 1, 1), tap(1, 1, 1),
      tap(0, 2, 1),
    ],
  },

  /*         X 8 4
     2 4 8 4 2    / 32  */
  burkes: {
    label: 'Burkes',
    divisor: 32,
    taps: [
      tap(1, 0, 8), tap(2, 0, 4),
      tap(-2, 1, 2), tap(-1, 1, 4), tap(0, 1, 8), tap(1, 1, 4), tap(2, 1, 2),
    ],
  },

  /*         X 5 3
     2 4 5 4 2
       2 3 2      / 32  */
  'sierra-3': {
    label: 'Sierra (3 row)',
    divisor: 32,
    taps: [
      tap(1, 0, 5), tap(2, 0, 3),
      tap(-2, 1, 2), tap(-1, 1, 4), tap(0, 1, 5), tap(1, 1, 4), tap(2, 1, 2),
      tap(-1, 2, 2), tap(0, 2, 3), tap(1, 2, 2),
    ],
  },

  /*         X 4 3
     1 2 3 2 1    / 16  */
  'sierra-2': {
    label: 'Sierra (2 row)',
    divisor: 16,
    taps: [
      tap(1, 0, 4), tap(2, 0, 3),
      tap(-2, 1, 1), tap(-1, 1, 2), tap(0, 1, 3), tap(1, 1, 2), tap(2, 1, 1),
    ],
  },

  /*     X 2
     1 1          / 4   */
  'sierra-lite': {
    label: 'Sierra Lite',
    divisor: 4,
    taps: [tap(1, 0, 2), tap(-1, 1, 1), tap(0, 1, 1)],
  },
} as const satisfies Record<string, DiffusionKernel>;

export type DiffusionKernelId = keyof typeof DIFFUSION_KERNELS;
