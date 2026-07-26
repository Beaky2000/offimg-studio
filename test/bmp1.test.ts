import { describe, expect, it } from 'vitest';
import {
  OFFIMG_HEIGHT,
  OFFIMG_WIDTH,
  bmp1FileSize,
  decodeBmp1,
  encodeBmp1,
  rowStride,
} from '../src/io/bmp1.js';

const PIXEL_DATA_OFFSET = 62;

function blank(width = OFFIMG_WIDTH, height = OFFIMG_HEIGHT): Uint8Array {
  return new Uint8Array(width * height);
}

describe('rowStride', () => {
  it('rounds each row up to a 4-byte boundary', () => {
    expect(rowStride(1)).toBe(4);
    expect(rowStride(8)).toBe(4);
    expect(rowStride(32)).toBe(4);
    // 33 px needs 5 bytes of bits, which rounds up to 8.
    expect(rowStride(33)).toBe(8);
    // The case that matters: 400 px = 50 bytes of bits in a 52-byte row.
    expect(rowStride(OFFIMG_WIDTH)).toBe(52);
  });
});

describe('encodeBmp1 headers', () => {
  const bytes = encodeBmp1(blank());
  const view = new DataView(bytes.buffer);

  it('produces a 12542-byte file for 400x240', () => {
    expect(bmp1FileSize(OFFIMG_WIDTH, OFFIMG_HEIGHT)).toBe(12542);
    expect(bytes.length).toBe(12542);
    expect(view.getUint32(2, true)).toBe(12542);
  });

  it('writes the BM signature and a pixel offset of 62', () => {
    expect(bytes[0]).toBe(0x42);
    expect(bytes[1]).toBe(0x4d);
    expect(view.getUint32(6, true)).toBe(0); // both reserved fields
    expect(view.getUint32(10, true)).toBe(PIXEL_DATA_OFFSET);
  });

  it('writes a plain 40-byte BITMAPINFOHEADER, 1bpp, BI_RGB', () => {
    expect(view.getUint32(14, true)).toBe(40);
    expect(view.getInt32(18, true)).toBe(OFFIMG_WIDTH);
    // Positive height: the DM42 expects bottom-up rows.
    expect(view.getInt32(22, true)).toBe(OFFIMG_HEIGHT);
    expect(view.getUint16(26, true)).toBe(1); // biPlanes
    expect(view.getUint16(28, true)).toBe(1); // biBitCount
    expect(view.getUint32(30, true)).toBe(0); // BI_RGB
    expect(view.getUint32(34, true)).toBe(52 * 240);
    // 0 = "maximum for this bit depth". Matches the reference OFFIMG byte for
    // byte; see test/referenceOffimg.test.ts.
    expect(view.getUint32(46, true)).toBe(0); // biClrUsed
    expect(view.getUint32(50, true)).toBe(0); // biClrImportant
  });

  it('writes a black-then-white colour table', () => {
    expect([...bytes.slice(54, 62)]).toEqual([0, 0, 0, 0, 0xff, 0xff, 0xff, 0]);
  });
});

describe('encodeBmp1 pixel layout', () => {
  it('stores rows bottom-up', () => {
    // One white pixel at the top-left of the image must land in the LAST
    // stored row, because biHeight is positive.
    const mono = blank();
    mono[0] = 255;
    const bytes = encodeBmp1(mono);

    const lastRow = PIXEL_DATA_OFFSET + 239 * 52;
    expect(bytes[lastRow]).toBe(0x80);
    // First stored row is the bottom image row, still empty.
    expect(bytes[PIXEL_DATA_OFFSET]).toBe(0x00);
  });

  it('packs the leftmost pixel into the most significant bit', () => {
    const mono = blank(8, 1);
    mono[0] = 255; // leftmost
    mono[7] = 255; // rightmost
    const bytes = encodeBmp1(mono, 8, 1);
    expect(bytes[PIXEL_DATA_OFFSET]).toBe(0b1000_0001);
  });

  it('leaves the row padding bytes zeroed', () => {
    const mono = blank();
    mono.fill(255);
    const bytes = encodeBmp1(mono);
    for (let y = 0; y < OFFIMG_HEIGHT; y++) {
      const row = PIXEL_DATA_OFFSET + y * 52;
      expect(bytes[row + 49]).toBe(0xff); // last byte holding real pixels
      expect(bytes[row + 50]).toBe(0x00); // padding
      expect(bytes[row + 51]).toBe(0x00);
    }
  });

  it('treats values >= 128 as white', () => {
    const mono = new Uint8Array([127, 128, 255, 0, 1, 200, 0, 0]);
    const bytes = encodeBmp1(mono, 8, 1);
    expect(bytes[PIXEL_DATA_OFFSET]).toBe(0b0110_0100);
  });

  it('inverts pixel bits but keeps the colour table canonical', () => {
    const mono = blank(8, 1);
    mono[0] = 255;
    const bytes = encodeBmp1(mono, 8, 1, true);
    expect(bytes[PIXEL_DATA_OFFSET]).toBe(0b0111_1111);
    expect([...bytes.slice(54, 62)]).toEqual([0, 0, 0, 0, 0xff, 0xff, 0xff, 0]);
  });

  it('rejects a pixel buffer of the wrong length', () => {
    expect(() => encodeBmp1(blank(10, 10), OFFIMG_WIDTH, OFFIMG_HEIGHT)).toThrow(
      /expected 96000 pixels/,
    );
  });
});

describe('round trip', () => {
  it('survives encode then decode unchanged', () => {
    // Deterministic pseudo-random pattern: exercises every bit position and
    // both row parities, unlike a flat fill.
    const mono = blank();
    let s = 12345;
    for (let i = 0; i < mono.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      mono[i] = s & 0x10000 ? 255 : 0;
    }

    const decoded = decodeBmp1(encodeBmp1(mono));
    expect(decoded.width).toBe(OFFIMG_WIDTH);
    expect(decoded.height).toBe(OFFIMG_HEIGHT);
    expect(decoded.topDown).toBe(false);
    expect(decoded.bitCount).toBe(1);
    expect(decoded.mono).toEqual(mono);
  });

  it('maps a set bit to white', () => {
    const mono = blank(8, 1);
    mono[3] = 255;
    const decoded = decodeBmp1(encodeBmp1(mono, 8, 1));
    expect([...decoded.bits]).toEqual([0, 0, 0, 1, 0, 0, 0, 0]);
    expect([...decoded.mono]).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
  });
});

describe('decodeBmp1 validation', () => {
  it('rejects a non-BMP', () => {
    expect(() => decodeBmp1(new Uint8Array(200))).toThrow(/BM/);
  });

  it('rejects a short file', () => {
    expect(() => decodeBmp1(new Uint8Array([0x42, 0x4d]))).toThrow(/too short/);
  });

  it('rejects a bit depth other than 1', () => {
    const bytes = encodeBmp1(blank(8, 1), 8, 1);
    new DataView(bytes.buffer).setUint16(28, 8, true);
    expect(() => decodeBmp1(bytes)).toThrow(/1 bit per pixel/);
  });

  it('rejects a V5 header', () => {
    const bytes = encodeBmp1(blank(8, 1), 8, 1);
    new DataView(bytes.buffer).setUint32(14, 124, true);
    expect(() => decodeBmp1(bytes)).toThrow(/BITMAPINFOHEADER/);
  });
});
