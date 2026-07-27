/** Writing the finished OFFIMG out to disk. */
import { OFFIMG_HEIGHT, OFFIMG_WIDTH, encodeBmp1 } from './bmp1.js';

// showSaveFilePicker is not in the standard DOM typings yet. Only the shape we
// actually use is declared.
interface WritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  /** The name the user actually settled on, which may differ from the suggestion. */
  readonly name: string;
  createWritable(): Promise<WritableFileStream>;
}
type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<SaveFileHandle>;

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

export interface SaveResult {
  outcome: SaveOutcome;
  /**
   * What the file ended up called. Taken from the picker handle when there was
   * a dialog, so renaming in the dialog is reflected; otherwise the name we
   * asked the browser to download as.
   */
  name: string;
}

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
 *
 * @param suggestedName What to pre-fill the dialog with. Only a suggestion: the
 *                      returned `name` is what the file was actually called.
 */
export async function saveOffimg(
  mono: Uint8Array,
  suggestedName: string,
): Promise<SaveResult> {
  const blob = encodeOffimg(mono);
  const name = ensureBmpExtension(suggestedName);
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
      // Report the handle's name, not the suggestion: the user is free to type
      // something else in the dialog, and claiming otherwise would be a lie.
      return { outcome: 'saved', name: handle.name || name };
    } catch (error) {
      // Dismissing the dialog is a normal outcome, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { outcome: 'cancelled', name };
      }
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
  // No dialog on this path, so there is nothing to report back but the name we
  // asked for. The browser may still deduplicate it against an existing file.
  return { outcome: 'downloaded', name };
}
