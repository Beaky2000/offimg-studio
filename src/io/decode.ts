/**
 * Image input: file picker, drag-and-drop, and clipboard paste all funnel here.
 *
 * Decoding is delegated to the browser, so the accepted format list is whatever
 * it supports (JPEG, PNG, GIF, WebP, BMP, AVIF, ...) rather than something we
 * maintain.
 */

export interface SourceImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Original file name, used to seed the output name. */
  name: string;
}

export async function decodeImageFile(file: File): Promise<SourceImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `Could not decode "${file.name || 'image'}". Your browser may not support this format.`,
    );
  }
  return { bitmap, width: bitmap.width, height: bitmap.height, name: file.name || 'image' };
}

/** Strip the extension and append .bmp, e.g. "photo.jpg" -> "photo.bmp". */
export function toBmpFilename(sourceName: string): string {
  const base = sourceName.replace(/\.[^./\\]+$/, '') || 'offimg';
  return `${base}.bmp`;
}

/** First image found in a drop or paste, or null. */
export function firstImageFile(items: FileList | DataTransferItemList | null): File | null {
  if (!items) return null;

  if (typeof FileList !== 'undefined' && items instanceof FileList) {
    for (const file of items) {
      if (file.type.startsWith('image/')) return file;
    }
    return null;
  }

  for (const item of items as DataTransferItemList) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}
