/**
 * Canvas preview helpers.
 *
 * Each preview keeps a 400x240 backing store and is scaled up purely in CSS at
 * integer zoom levels with image-rendering: pixelated. Letting the canvas
 * itself be larger, or allowing smooth scaling, would show the user a filtered
 * version of a dither pattern — which is precisely the thing they are trying to
 * judge.
 */
import { OFFIMG_HEIGHT, OFFIMG_WIDTH } from '../io/bmp1.js';

export class Preview {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scratch: ImageData;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = OFFIMG_WIDTH;
    canvas.height = OFFIMG_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.scratch = ctx.createImageData(OFFIMG_WIDTH, OFFIMG_HEIGHT);
  }

  setZoom(zoom: number): void {
    this.canvas.style.width = `${OFFIMG_WIDTH * zoom}px`;
    this.canvas.style.height = `${OFFIMG_HEIGHT * zoom}px`;
  }

  putRgba(rgba: Uint8ClampedArray): void {
    this.scratch.data.set(rgba);
    this.ctx.putImageData(this.scratch, 0, 0);
  }

  /** One byte per pixel, expanded to RGB in place. */
  putGray(gray: Uint8Array): void {
    const data = this.scratch.data;
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const v = gray[i];
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
    this.ctx.putImageData(this.scratch, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, OFFIMG_WIDTH, OFFIMG_HEIGHT);
  }
}

/** Plot a 256-entry tone curve so the effect of the sliders is legible at a glance. */
export function drawCurve(canvas: HTMLCanvasElement, lut: Uint8Array): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = canvas.width;
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
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let v = 0; v < 256; v++) {
    const x = (v / 255) * (size - 1);
    const y = (size - 1) * (1 - lut[v] / 255);
    if (v === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
