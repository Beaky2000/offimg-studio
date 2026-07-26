/**
 * Writing the finished OFFIMG out, and checking that what we wrote is what we
 * meant to write.
 */
import { OFFIMG_HEIGHT, OFFIMG_WIDTH, encodeBmp1 } from './bmp1.js';

// showSaveFilePicker is not in the standard DOM typings yet. Only the shape we
// actually use is declared.
interface WritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  createWritable(): Promise<WritableFileStream>;
}
type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<SaveFileHandle>;

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

export function ensureBmpExtension(name: string): string {
  const trimmed = name.trim() || 'offimg';
  return /\.bmp$/i.test(trimmed) ? trimmed : `${trimmed}.bmp`;
}

export function encodeOffimg(mono: Uint8Array): Blob {
  // `invert` stays false here: stage 4 has already applied the user's inversion,
  // so the preview and the file always agree.
  const bytes = encodeBmp1(mono, OFFIMG_WIDTH, OFFIMG_HEIGHT, false);
  return new Blob([bytes as unknown as BlobPart], { type: 'image/bmp' });
}

/**
 * Prefer a real Save dialog where the browser offers one (Chrome and Edge on
 * Windows), otherwise fall back to a plain download.
 */
export async function saveOffimg(mono: Uint8Array, filename: string): Promise<SaveOutcome> {
  const blob = encodeOffimg(mono);
  const name = ensureBmpExtension(filename);
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker })
    .showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: 'Windows bitmap', accept: { 'image/bmp': ['.bmp'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (error) {
      // Dismissing the dialog is a normal outcome, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export interface VerifyResult {
  ok: boolean;
  message: string;
}

/**
 * Re-decode the encoded file and compare it against the pixels we intended.
 *
 * This deliberately uses the browser's own BMP decoder via createImageBitmap
 * rather than our decodeBmp1: an independent implementation is what makes the
 * check meaningful. Row order, row padding, bit order within a byte and palette
 * polarity would all show up here as mismatches.
 */
export async function verifyOffimg(mono: Uint8Array): Promise<VerifyResult> {
  const blob = encodeOffimg(mono);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return { ok: false, message: 'The encoded BMP could not be decoded back by the browser.' };
  }

  if (bitmap.width !== OFFIMG_WIDTH || bitmap.height !== OFFIMG_HEIGHT) {
    return {
      ok: false,
      message: `Decoded size is ${bitmap.width}x${bitmap.height}, expected ${OFFIMG_WIDTH}x${OFFIMG_HEIGHT}.`,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = OFFIMG_WIDTH;
  canvas.height = OFFIMG_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false, message: 'Could not create a canvas to check the output.' };
  ctx.drawImage(bitmap, 0, 0);
  const decoded = ctx.getImageData(0, 0, OFFIMG_WIDTH, OFFIMG_HEIGHT).data;

  let mismatches = 0;
  let firstX = -1;
  let firstY = -1;
  for (let i = 0; i < mono.length; i++) {
    const decodedWhite = decoded[i * 4] >= 128;
    if (decodedWhite !== mono[i] >= 128) {
      if (mismatches === 0) {
        firstX = i % OFFIMG_WIDTH;
        firstY = (i / OFFIMG_WIDTH) | 0;
      }
      mismatches++;
    }
  }

  if (mismatches > 0) {
    return {
      ok: false,
      message: `${mismatches} of ${mono.length} pixels differ after re-decoding (first at ${firstX},${firstY}).`,
    };
  }

  return {
    ok: true,
    message: `Verified: 400×240, 1-bit, ${blob.size} bytes, all ${mono.length} pixels round-trip exactly.`,
  };
}
