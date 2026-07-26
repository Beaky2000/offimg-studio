/**
 * Stage 1: fit an arbitrary image into the 400x240 OFFIMG frame.
 *
 * Geometry is a pure function (`computeDrawRect`) so it can be tested without a
 * DOM; only the actual rasterisation touches a canvas.
 */
import { OFFIMG_HEIGHT, OFFIMG_WIDTH } from '../io/bmp1.js';

export type FitMode = 'fill' | 'fit-white' | 'fit-black';

export interface FrameSettings {
  mode: FitMode;
  /** Where to take the crop from along the overflowing axis, 0-100. */
  cropPos: number;
}

export const DEFAULT_FRAME: FrameSettings = { mode: 'fill', cropPos: 50 };

export const TARGET_ASPECT = OFFIMG_WIDTH / OFFIMG_HEIGHT; // 5:3

/**
 * Sources within 0.5% of 5:3 are treated as an exact match. Real-world images
 * are often a pixel or two off from a resize, and offering a crop/pad choice
 * for a half-pixel discrepancy is just noise.
 */
export const ASPECT_TOLERANCE = 0.005;

export function aspectMatchesTarget(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height / TARGET_ASPECT - 1) <= ASPECT_TOLERANCE;
}

export interface DrawRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Destination rectangle for the source image inside the 400x240 frame.
 *
 * `fill` scales to cover and lets one axis overflow; `cropPos` slides the image
 * along that axis so the user chooses what gets cut. `fit-*` scales to contain,
 * centred, leaving the background visible.
 */
export function computeDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  settings: FrameSettings,
): DrawRect {
  const scale =
    settings.mode === 'fill'
      ? Math.max(OFFIMG_WIDTH / sourceWidth, OFFIMG_HEIGHT / sourceHeight)
      : Math.min(OFFIMG_WIDTH / sourceWidth, OFFIMG_HEIGHT / sourceHeight);

  const dw = sourceWidth * scale;
  const dh = sourceHeight * scale;

  if (settings.mode === 'fill') {
    const t = Math.min(Math.max(settings.cropPos, 0), 100) / 100;
    // Only one axis overflows; the other lands exactly on target.
    return {
      dx: cropOffset(dw - OFFIMG_WIDTH, t),
      dy: cropOffset(dh - OFFIMG_HEIGHT, t),
      dw,
      dh,
    };
  }

  return {
    dx: (OFFIMG_WIDTH - dw) / 2,
    dy: (OFFIMG_HEIGHT - dh) / 2,
    dw,
    dh,
  };
}

/**
 * How far to shift the image back along an axis that overflows by `overflow`,
 * for crop position `t` in 0..1.
 *
 * Returns a plain 0 rather than -0 when there is nothing to shift: -0 draws the
 * same but is a nuisance to assert against, and it also absorbs the
 * floating-point dust that shows up on the axis that lands exactly on target.
 */
function cropOffset(overflow: number, t: number): number {
  const shift = overflow * t;
  return shift > 0 ? -shift : 0;
}

/** Colour behind the image: what `fit` pads with, and what transparency composites onto. */
export function backgroundColor(mode: FitMode): string {
  return mode === 'fit-black' ? '#000000' : '#ffffff';
}

let frameCanvas: HTMLCanvasElement | null = null;
// Two canvases so the halving loop can ping-pong; a canvas cannot be resized
// and drawn onto itself in one step.
const halveCanvases: HTMLCanvasElement[] = [];

function getFrameContext(): CanvasRenderingContext2D {
  if (!frameCanvas) {
    frameCanvas = document.createElement('canvas');
    frameCanvas.width = OFFIMG_WIDTH;
    frameCanvas.height = OFFIMG_HEIGHT;
  }
  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

/**
 * Halve the source repeatedly until it is within 2x of the final size.
 *
 * A single drawImage doing a large reduction aliases badly (browsers sample far
 * too few source pixels), and dithering then turns that aliasing into obvious
 * pattern noise. Successive halving is effectively a box-filter mip chain and
 * costs almost nothing at these sizes.
 */
function prescale(source: CanvasImageSource, sw: number, sh: number, dw: number, dh: number) {
  let current = source;
  let width = sw;
  let height = sh;
  let slot = 0;

  while (width > dw * 2 && height > dh * 2) {
    const nextWidth = Math.max(1, Math.floor(width / 2));
    const nextHeight = Math.max(1, Math.floor(height / 2));

    let canvas = halveCanvases[slot];
    if (!canvas) {
      canvas = document.createElement('canvas');
      halveCanvases[slot] = canvas;
    }
    canvas.width = nextWidth;
    canvas.height = nextHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, nextWidth, nextHeight);

    current = canvas;
    width = nextWidth;
    height = nextHeight;
    slot ^= 1;
  }

  return current;
}

/** Rasterise the source into a 400x240 RGBA buffer. Alpha is always 255 on return. */
export function frameImage(
  source: ImageBitmap | HTMLImageElement,
  settings: FrameSettings,
): Uint8ClampedArray {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const rect = computeDrawRect(sourceWidth, sourceHeight, settings);
  const ctx = getFrameContext();

  // Fill first so `fit` padding is opaque and any transparency in the source
  // composites onto a defined colour rather than showing up as black later.
  ctx.fillStyle = backgroundColor(settings.mode);
  ctx.fillRect(0, 0, OFFIMG_WIDTH, OFFIMG_HEIGHT);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const prescaled = prescale(source, sourceWidth, sourceHeight, rect.dw, rect.dh);
  ctx.drawImage(prescaled, rect.dx, rect.dy, rect.dw, rect.dh);

  return ctx.getImageData(0, 0, OFFIMG_WIDTH, OFFIMG_HEIGHT).data;
}
