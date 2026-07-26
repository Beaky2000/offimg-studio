/**
 * 1-bit BMP encoder / decoder for SwissMicros OFFIMG files.
 *
 * The DM42 only accepts what its docs call a "Windows NT" BMP: a 14-byte
 * BITMAPFILEHEADER followed by a plain 40-byte BITMAPINFOHEADER, uncompressed
 * (BI_RGB), 1 bit per pixel, with a 2-entry colour table. Anything fancier
 * (BITMAPV4/V5 headers, RLE compression, an OS/2 BITMAPCOREHEADER) is rejected
 * by the firmware, so this writes the plain form and nothing else.
 *
 * Two details are where hand-rolled BMP writers usually go wrong, and both are
 * covered by tests:
 *   - Rows are stored bottom-up (positive biHeight), so row 0 of the file is
 *     the *last* row of the image.
 *   - Each row is padded to a 4-byte boundary. At 400 px wide that is 50 bytes
 *     of pixels in a 52-byte row, i.e. 2 bytes of padding per row.
 *
 * Polarity: palette index 0 is black and index 1 is white, so a set bit means
 * white. This is confirmed twice over — it matches the colour table of a real
 * off-image byte for byte (see test/referenceOffimg.test.ts), and output written
 * by this encoder has been displayed on a DM42 the right way round.
 *
 * `invert` flips the pixel bits rather than the palette, so the colour table
 * stays in that confirmed-good form either way. It exists as a creative choice,
 * not as a workaround for uncertainty about polarity.
 */

export const OFFIMG_WIDTH = 400;
export const OFFIMG_HEIGHT = 240;

const FILE_HEADER_SIZE = 14;
const INFO_HEADER_SIZE = 40;
const PALETTE_SIZE = 8; // 2 entries x 4 bytes (BGRX)
const PIXEL_DATA_OFFSET = FILE_HEADER_SIZE + INFO_HEADER_SIZE + PALETTE_SIZE; // 62
const BI_RGB = 0;

/** Bytes per stored row: pixel bits rounded up to a whole 4-byte multiple. */
export function rowStride(width: number): number {
  return ((width + 31) >> 5) << 2;
}

/** Total size of the .bmp file that `encodeBmp1` will produce. */
export function bmp1FileSize(width: number, height: number): number {
  return PIXEL_DATA_OFFSET + rowStride(width) * height;
}

/**
 * Pack one byte-per-pixel monochrome data into a 1-bit BMP.
 *
 * @param mono   width*height bytes in top-down row order. Any value >= 128 is
 *               treated as white; this accepts both the 0/255 output of the
 *               dither stage and raw 0/1 masks.
 * @param invert Swap black and white in the output.
 */
export function encodeBmp1(
  mono: Uint8Array,
  width = OFFIMG_WIDTH,
  height = OFFIMG_HEIGHT,
  invert = false,
): Uint8Array {
  if (mono.length !== width * height) {
    throw new Error(
      `encodeBmp1: expected ${width * height} pixels for ${width}x${height}, got ${mono.length}`,
    );
  }

  const stride = rowStride(width);
  const imageSize = stride * height;
  const fileSize = PIXEL_DATA_OFFSET + imageSize;

  const bytes = new Uint8Array(fileSize);
  const view = new DataView(bytes.buffer);

  // --- BITMAPFILEHEADER ---
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true); // bfReserved1 + bfReserved2
  view.setUint32(10, PIXEL_DATA_OFFSET, true);

  // --- BITMAPINFOHEADER ---
  view.setUint32(14, INFO_HEADER_SIZE, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive => bottom-up rows
  view.setUint16(26, 1, true); // biPlanes
  view.setUint16(28, 1, true); // biBitCount
  view.setUint32(30, BI_RGB, true);
  view.setUint32(34, imageSize, true);
  view.setInt32(38, 0, true); // biXPelsPerMeter (unspecified)
  view.setInt32(42, 0, true); // biYPelsPerMeter
  // 0 means "the maximum for this bit depth", i.e. 2 entries. Writing 2 here
  // would be equally legal, but the reference OFFIMG pulled off a calculator
  // uses 0, and matching a file the firmware demonstrably accepts leaves no
  // room for doubt. See test/referenceOffimg.test.ts.
  view.setUint32(46, 0, true); // biClrUsed
  view.setUint32(50, 0, true); // biClrImportant

  // --- Colour table: index 0 black, index 1 white (BGRX) ---
  bytes[54] = 0x00;
  bytes[55] = 0x00;
  bytes[56] = 0x00;
  bytes[57] = 0x00;
  bytes[58] = 0xff;
  bytes[59] = 0xff;
  bytes[60] = 0xff;
  bytes[61] = 0x00;

  // --- Pixel data, bottom-up ---
  for (let y = 0; y < height; y++) {
    const srcRow = y * width;
    const dstRow = PIXEL_DATA_OFFSET + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      let white = mono[srcRow + x] >= 128;
      if (invert) white = !white;
      if (white) {
        // Most significant bit is the leftmost pixel of the byte.
        bytes[dstRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  return bytes;
}

export interface DecodedBmp1 {
  width: number;
  height: number;
  /** True when biHeight was negative, i.e. rows stored top-down. */
  topDown: boolean;
  headerSize: number;
  bitCount: number;
  compression: number;
  pixelDataOffset: number;
  rowStride: number;
  /** Colour table entries in index order. */
  palette: Array<{ r: number; g: number; b: number }>;
  /** Palette index per pixel (0 or 1), reordered to top-down. */
  bits: Uint8Array;
  /** 0 or 255 per pixel, top-down, resolved through the palette. */
  mono: Uint8Array;
}

/**
 * Minimal 1-bit BMP reader. Used to check our own output round-trips and to
 * inspect a known-good OFFIMG from a calculator; it is not a general BMP
 * decoder and deliberately refuses anything that isn't the plain 1-bit form.
 */
export function decodeBmp1(bytes: Uint8Array): DecodedBmp1 {
  if (bytes.length < FILE_HEADER_SIZE + INFO_HEADER_SIZE) {
    throw new Error('decodeBmp1: file is too short to be a BMP');
  }
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new Error('decodeBmp1: missing "BM" signature');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelDataOffset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  if (headerSize !== INFO_HEADER_SIZE) {
    throw new Error(
      `decodeBmp1: expected a 40-byte BITMAPINFOHEADER, got ${headerSize} bytes`,
    );
  }

  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const bitCount = view.getUint16(28, true);
  const compression = view.getUint32(30, true);

  if (bitCount !== 1) {
    throw new Error(`decodeBmp1: expected 1 bit per pixel, got ${bitCount}`);
  }
  if (compression !== BI_RGB) {
    throw new Error(`decodeBmp1: expected uncompressed BI_RGB, got ${compression}`);
  }

  const palette: Array<{ r: number; g: number; b: number }> = [];
  for (let i = 0; i < 2; i++) {
    const p = FILE_HEADER_SIZE + headerSize + i * 4;
    palette.push({ b: bytes[p], g: bytes[p + 1], r: bytes[p + 2] });
  }

  const stride = rowStride(width);
  if (bytes.length < pixelDataOffset + stride * height) {
    throw new Error('decodeBmp1: pixel data is truncated');
  }

  // Perceived brightness of each palette entry, so `mono` is correct whichever
  // way round the colour table is.
  const paletteIsWhite = palette.map((c) => c.r + c.g + c.b >= 383);

  const bits = new Uint8Array(width * height);
  const mono = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const srcRow = pixelDataOffset + (topDown ? y : height - 1 - y) * stride;
    const dstRow = y * width;
    for (let x = 0; x < width; x++) {
      const bit = (bytes[srcRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      bits[dstRow + x] = bit;
      mono[dstRow + x] = paletteIsWhite[bit] ? 255 : 0;
    }
  }

  return {
    width,
    height,
    topDown,
    headerSize,
    bitCount,
    compression,
    pixelDataOffset,
    rowStride: stride,
    palette,
    bits,
    mono,
  };
}
