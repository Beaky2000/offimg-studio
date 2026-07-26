/**
 * Validates the encoder against a real OFFIMG taken off a calculator.
 *
 * Two tiers, because the calculator's stock off-images are SwissMicros' own
 * artwork and do not belong in this repository:
 *
 *  1. `samples/reference-header.bin` is the 62-byte header (file header, info
 *     header and colour table) of a genuine OFFIMG, with no pixel data at all.
 *     That is format information rather than creative content, so it is
 *     committed and this check always runs — including in CI. It is what pins
 *     down black/white polarity, row order and every header field.
 *
 *  2. If you drop a whole OFFIMG at `samples/reference-offimg.bmp` (copy one out
 *     of the /OFFIMG/ folder on your own DM42), the pixel data is round-tripped
 *     through our encoder as well. That file is gitignored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OFFIMG_HEIGHT, OFFIMG_WIDTH, decodeBmp1, encodeBmp1, rowStride } from '../src/io/bmp1.js';

const HEADER_PATH = fileURLToPath(new URL('../samples/reference-header.bin', import.meta.url));
const FULL_IMAGE_PATH = fileURLToPath(new URL('../samples/reference-offimg.bmp', import.meta.url));

describe('reference OFFIMG header', () => {
  const reference = new Uint8Array(readFileSync(HEADER_PATH));
  // Content is irrelevant to the header, so a blank frame is enough.
  const ours = encodeBmp1(new Uint8Array(OFFIMG_WIDTH * OFFIMG_HEIGHT));

  it('is 62 bytes: 14 + 40 + an 8-byte colour table', () => {
    expect(reference).toHaveLength(62);
  });

  it('matches our encoder byte for byte', () => {
    // Every field, including biXPelsPerMeter/biYPelsPerMeter (both 0 in real
    // OFFIMG files) and biClrUsed/biClrImportant (also 0, meaning "the maximum
    // for this bit depth"). If this fails, the encoder has drifted away from
    // what the firmware is known to accept.
    expect([...ours.subarray(0, 62)]).toEqual([...reference]);
  });

  it('confirms black is palette index 0', () => {
    // The polarity question, settled from evidence: a set bit means white.
    expect([...reference.subarray(54, 62)]).toEqual([0, 0, 0, 0, 0xff, 0xff, 0xff, 0]);
  });

  it('confirms bottom-up rows and 1 bit per pixel', () => {
    const view = new DataView(reference.buffer, reference.byteOffset, reference.byteLength);
    expect(view.getInt32(22, true)).toBe(OFFIMG_HEIGHT); // positive => bottom-up
    expect(view.getUint16(28, true)).toBe(1);
    expect(view.getUint32(30, true)).toBe(0); // BI_RGB
    expect(view.getUint32(34, true)).toBe(rowStride(OFFIMG_WIDTH) * OFFIMG_HEIGHT);
  });
});

// Everything here loads lazily inside the test bodies. vitest executes a
// skipped describe's callback while collecting tests, so reading or decoding
// the file in the suite body would throw on a fresh clone where it is absent.
function loadFullImage() {
  const reference = new Uint8Array(readFileSync(FULL_IMAGE_PATH));
  return { reference, decoded: decodeBmp1(reference) };
}

describe.runIf(existsSync(FULL_IMAGE_PATH))('reference OFFIMG pixel data', () => {
  it('is a plain 400x240 1-bit BI_RGB bitmap', () => {
    const { decoded } = loadFullImage();
    expect(decoded.width).toBe(OFFIMG_WIDTH);
    expect(decoded.height).toBe(OFFIMG_HEIGHT);
    expect(decoded.headerSize).toBe(40);
    expect(decoded.bitCount).toBe(1);
    expect(decoded.topDown).toBe(false);
  });

  it('re-encodes to a byte-identical file', () => {
    // Decoding then re-encoding a real file and getting the same bytes back
    // checks row order, 4-byte row padding, bit order within each byte and
    // polarity all at once.
    const { reference, decoded } = loadFullImage();
    const reencoded = encodeBmp1(decoded.mono, OFFIMG_WIDTH, OFFIMG_HEIGHT);
    expect([...reencoded]).toEqual([...reference]);
  });
});
