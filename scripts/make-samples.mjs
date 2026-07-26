/**
 * Generates the test images in samples/. Dev utility, run with:
 *   node scripts/make-samples.mjs
 *
 * Writes uncompressed 24-bit BMPs so this needs no image library. The card is
 * designed to make the pipeline's behaviour visible at a glance:
 *   - a smooth gray ramp shows banding and dither quality;
 *   - saturated R/G/B bars show whether grayscale is being mixed in linear
 *     light (they should read roughly 126 / 219 / 77, not 54 / 182 / 18);
 *   - fine diagonal lines show how well the downscale filters.
 *
 * Three aspect ratios are produced so the framing stage can be exercised:
 * exactly 5:3, too wide, and too tall.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');

/** Uncompressed 24-bit BMP: bottom-up rows, each padded to a 4-byte boundary. */
function encodeBmp24(width, height, getPixel) {
  const stride = (width * 3 + 3) & ~3;
  const imageSize = stride * height;
  const bytes = Buffer.alloc(54 + imageSize);

  bytes.write('BM', 0, 'ascii');
  bytes.writeUInt32LE(54 + imageSize, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(0, 30);
  bytes.writeUInt32LE(imageSize, 34);

  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = getPixel(x, y, width, height);
      const p = row + x * 3;
      bytes[p] = b;
      bytes[p + 1] = g;
      bytes[p + 2] = r;
    }
  }
  return bytes;
}

function testCard(x, y, width, height) {
  const u = x / (width - 1);
  const v = y / (height - 1);

  // Bottom third: saturated primary bars.
  if (v > 0.68) {
    if (v > 0.9) {
      // Fine diagonal lines, to see what the downscale filter does.
      return ((x + y) % 6 < 3 ? [255, 255, 255] : [0, 0, 0]);
    }
    const band = Math.floor(u * 3);
    return band === 0 ? [255, 0, 0] : band === 1 ? [0, 255, 0] : [0, 0, 255];
  }

  // Middle band: a hard step wedge, for judging black/white point behaviour.
  if (v > 0.5) {
    const step = Math.floor(u * 8) / 7;
    const level = Math.round(step * 255);
    return [level, level, level];
  }

  // Top half: smooth ramp, darkening slightly towards the bottom so the ramp
  // is two-dimensional and dither patterns are easy to see.
  const level = Math.round(255 * u * (1 - v * 0.35));
  return [level, level, level];
}

const targets = [
  ['test-exact-800x480.bmp', 800, 480],
  ['test-wide-1000x400.bmp', 1000, 400],
  ['test-tall-500x1000.bmp', 500, 1000],
];

mkdirSync(SAMPLES_DIR, { recursive: true });
for (const [name, width, height] of targets) {
  const bytes = encodeBmp24(width, height, testCard);
  writeFileSync(join(SAMPLES_DIR, name), bytes);
  console.log(`${name}  ${width}x${height}  ${bytes.length} bytes`);
}
