/**
 * Canvas preview helpers.
 *
 * Previews are sized in **device** pixels, not CSS pixels. That distinction is
 * the whole point of this module.
 *
 * The obvious approach — a 400x240 canvas scaled up with CSS and
 * `image-rendering: pixelated` — only looks right when the OS display scale is
 * 100%. At 125% the device pixel ratio is 1.25, so a 2x zoom asks for 2.5
 * device pixels per image pixel; the browser has to round each one, and columns
 * come out alternately 2 and 3 device pixels wide. Edges look jagged and the
 * dither pattern appears to have uneven pixels, which is fatal for a tool whose
 * job is judging that pattern.
 *
 * So instead: the backing store is `400*scale` x `240*scale` where `scale` is an
 * integer count of device pixels per image pixel, the image is blitted into it
 * with smoothing off (an exact integer nearest-neighbour expansion), and the CSS
 * size is set to `backing / devicePixelRatio` so backing pixels land 1:1 on
 * device pixels. Every image pixel then covers exactly `scale` x `scale` device
 * pixels at any display scale.
 *
 * The trade-off is deliberate: at 125% the preview is physically the same size
 * as it would be at 100%, so it looks smaller relative to the surrounding text.
 * That is what "scaled to physical pixels" means, and it is the only way to get
 * evenly sized pixels.
 */
import { OFFIMG_HEIGHT, OFFIMG_WIDTH } from '../io/bmp1.js';

export class Preview {
  private readonly ctx: CanvasRenderingContext2D;
  /** Holds the current frame at native 400x240, ready to be blitted up. */
  private readonly source: HTMLCanvasElement;
  private readonly sourceCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.source = document.createElement('canvas');
    this.source.width = OFFIMG_WIDTH;
    this.source.height = OFFIMG_HEIGHT;
    const sourceCtx = this.source.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) throw new Error('2D canvas context unavailable');
    this.sourceCtx = sourceCtx;
    this.image = sourceCtx.createImageData(OFFIMG_WIDTH, OFFIMG_HEIGHT);
  }

  /**
   * @param scale Device pixels per image pixel. Must be a positive integer;
   *              this is what guarantees uniform pixel sizes.
   * @param dpr   window.devicePixelRatio.
   */
  setScale(scale: number, dpr: number): void {
    const width = OFFIMG_WIDTH * scale;
    const height = OFFIMG_HEIGHT * scale;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      // Assigning width/height clears the canvas and resets context state,
      // including imageSmoothingEnabled, so repaint() re-establishes it below.
      this.canvas.width = width;
      this.canvas.height = height;
    }

    // Backing pixels map 1:1 onto device pixels, so the browser applies no
    // scaling filter of its own.
    this.canvas.style.width = `${width / dpr}px`;
    this.canvas.style.height = `${height / dpr}px`;

    this.repaint();
  }

  putRgba(rgba: Uint8ClampedArray): void {
    this.image.data.set(rgba);
    this.commit();
  }

  /** One byte per pixel, expanded to RGB. */
  putGray(gray: Uint8Array): void {
    const data = this.image.data;
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const v = gray[i];
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
    this.commit();
  }

  private commit(): void {
    this.sourceCtx.putImageData(this.image, 0, 0);
    this.repaint();
  }

  private repaint(): void {
    // Integer nearest-neighbour expansion. Smoothing must be off, and must be
    // set after any canvas resize, which resets it.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      this.source,
      0,
      0,
      OFFIMG_WIDTH,
      OFFIMG_HEIGHT,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
  }
}

/**
 * Plot a 256-entry tone curve so the effect of the sliders is legible at a
 * glance. Also sized in device pixels, for the same reason as the previews.
 */
export function drawCurve(canvas: HTMLCanvasElement, lut: Uint8Array, dpr: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // The CSS box is a fixed 96px square (see style.css); match the backing store
  // to that in device pixels so the plot is not resampled.
  const cssSize = 96;
  const size = Math.max(1, Math.round(cssSize * dpr));
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }

  const styles = getComputedStyle(canvas);
  ctx.clearRect(0, 0, size, size);

  // Quarter grid, plus the identity diagonal for reference.
  ctx.strokeStyle = styles.borderColor || '#343a44';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const p = Math.round((i / 4) * size) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = styles.getPropertyValue('--accent').trim() || '#5aa9ff';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  for (let v = 0; v < 256; v++) {
    const x = (v / 255) * (size - 1);
    const y = (size - 1) * (1 - lut[v] / 255);
    if (v === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
