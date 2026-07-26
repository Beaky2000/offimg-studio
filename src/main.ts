/**
 * Wiring: DOM controls -> state -> pipeline -> previews.
 *
 * The pipeline is staged and every stage caches its output. A control change
 * marks the stage it belongs to as dirty and recomputes that stage onward,
 * coalesced into one requestAnimationFrame callback. There is no debouncing:
 * a full recompute of all four stages on 96,000 pixels is a few milliseconds,
 * so dragging a slider updates the dithered result on every frame.
 */
import './style.css';

import { OFFIMG_HEIGHT, OFFIMG_WIDTH } from './io/bmp1.js';
import { decodeImageFile, firstImageFile, toBmpFilename, type SourceImage } from './io/decode.js';
import { ensureBmpExtension, saveOffimg, verifyOffimg } from './io/save.js';
import {
  DEFAULT_DITHER,
  DITHER_OPTIONS,
  dither,
  findDitherOption,
  type DitherId,
  type DitherSettings,
} from './pipeline/dither.js';
import {
  DEFAULT_FRAME,
  aspectMatchesTarget,
  frameImage,
  type FitMode,
  type FrameSettings,
} from './pipeline/frame.js';
import { toGrayscale } from './pipeline/gray.js';
import {
  DEFAULT_LEVELS,
  applyLut,
  buildLevelsLut,
  type LevelSettings,
} from './pipeline/levels.js';
import { Preview, drawCurve } from './ui/preview.js';

const STAGE_FRAME = 1;
const STAGE_GRAY = 2;
const STAGE_LEVELS = 3;
const STAGE_DITHER = 4;
const STAGE_NONE = 5;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

// --- DOM -------------------------------------------------------------------

const dom = {
  pickFile: el<HTMLButtonElement>('pick-file'),
  fileInput: el<HTMLInputElement>('file-input'),
  dropzone: el<HTMLDivElement>('dropzone'),
  sourceInfo: el<HTMLParagraphElement>('source-info'),
  stages: el<HTMLElement>('stages'),
  zoom: el<HTMLSelectElement>('zoom'),

  arNote: el<HTMLParagraphElement>('ar-note'),
  fitModes: el<HTMLFieldSetElement>('fit-modes'),
  cropPosField: el<HTMLLabelElement>('crop-pos-field'),
  cropPos: el<HTMLInputElement>('crop-pos'),
  cropPosOut: el<HTMLOutputElement>('crop-pos-out'),

  blackPoint: el<HTMLInputElement>('black-point'),
  blackOut: el<HTMLOutputElement>('black-out'),
  whitePoint: el<HTMLInputElement>('white-point'),
  whiteOut: el<HTMLOutputElement>('white-out'),
  contrast: el<HTMLInputElement>('contrast'),
  contrastOut: el<HTMLOutputElement>('contrast-out'),
  resetLevels: el<HTMLButtonElement>('reset-levels'),
  curve: el<HTMLCanvasElement>('curve'),

  algorithm: el<HTMLSelectElement>('algorithm'),
  serpentine: el<HTMLInputElement>('serpentine'),
  invert: el<HTMLInputElement>('invert'),
  seedField: el<HTMLLabelElement>('seed-field'),
  seed: el<HTMLInputElement>('seed'),
  seedOut: el<HTMLOutputElement>('seed-out'),

  filename: el<HTMLInputElement>('filename'),
  save: el<HTMLButtonElement>('save'),
  verify: el<HTMLButtonElement>('verify'),
  saveStatus: el<HTMLParagraphElement>('save-status'),
};

const previews = {
  frame: new Preview(el<HTMLCanvasElement>('canvas-frame')),
  gray: new Preview(el<HTMLCanvasElement>('canvas-gray')),
  levels: new Preview(el<HTMLCanvasElement>('canvas-levels')),
  dither: new Preview(el<HTMLCanvasElement>('canvas-dither')),
};

// --- State -----------------------------------------------------------------

const state: {
  frame: FrameSettings;
  levels: LevelSettings;
  dither: DitherSettings;
  zoom: number;
} = {
  frame: { ...DEFAULT_FRAME },
  levels: { ...DEFAULT_LEVELS },
  dither: { ...DEFAULT_DITHER },
  zoom: 2,
};

let source: SourceImage | null = null;
let aspectMatches = false;

// Cached stage outputs, reused across recomputes to avoid per-frame allocation.
let framed: Uint8ClampedArray | null = null;
let gray: Uint8Array | null = null;
let toned: Uint8Array | null = null;
let mono: Uint8Array | null = null;

let dirtyFrom = STAGE_NONE;
let frameRequested = false;

function invalidate(stage: number): void {
  if (stage < dirtyFrom) dirtyFrom = stage;
  if (!frameRequested) {
    frameRequested = true;
    requestAnimationFrame(recompute);
  }
}

function recompute(): void {
  frameRequested = false;
  const from = dirtyFrom;
  dirtyFrom = STAGE_NONE;
  if (!source || from === STAGE_NONE) return;

  if (from <= STAGE_FRAME) {
    framed = frameImage(source.bitmap, state.frame);
    previews.frame.putRgba(framed);
  }
  if (from <= STAGE_GRAY && framed) {
    gray = toGrayscale(framed, gray ?? undefined);
    previews.gray.putGray(gray);
  }
  if (from <= STAGE_LEVELS && gray) {
    const lut = buildLevelsLut(state.levels);
    toned = applyLut(gray, lut, toned ?? undefined);
    previews.levels.putGray(toned);
    drawCurve(dom.curve, lut);
  }
  if (from <= STAGE_DITHER && toned) {
    mono = dither(toned, OFFIMG_WIDTH, OFFIMG_HEIGHT, state.dither, mono ?? undefined);
    previews.dither.putGray(mono);
  }
}

// --- Loading ---------------------------------------------------------------

async function loadFile(file: File): Promise<void> {
  try {
    const loaded = await decodeImageFile(file);
    source?.bitmap.close();
    source = loaded;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'err');
    return;
  }

  aspectMatches = aspectMatchesTarget(source.width, source.height);
  dom.stages.hidden = false;
  dom.dropzone.classList.add('compact');
  dom.sourceInfo.hidden = false;
  dom.sourceInfo.textContent =
    `${source.name} — ${source.width}×${source.height} ` +
    `(${(source.width / source.height).toFixed(3)}:1)` +
    (aspectMatches ? ', matches 5:3' : ', does not match 5:3 (1.667:1)');

  dom.filename.value = toBmpFilename(source.name);
  setStatus('', null);
  updateFrameControls();
  invalidate(STAGE_FRAME);
}

function updateFrameControls(): void {
  dom.fitModes.disabled = aspectMatches;
  if (aspectMatches) {
    dom.arNote.textContent =
      'Aspect ratio already matches 5:3, so the image is scaled straight to 400×240 with nothing cropped or padded.';
  } else {
    const cropsHorizontally = source ? source.width / source.height > OFFIMG_WIDTH / OFFIMG_HEIGHT : true;
    dom.arNote.textContent =
      state.frame.mode === 'fill'
        ? `Filling the frame crops the ${cropsHorizontally ? 'left and right edges' : 'top and bottom'}.`
        : 'Fitting the whole image inside the frame leaves bars along the ' +
          `${cropsHorizontally ? 'top and bottom' : 'left and right edges'}.`;
  }
  dom.cropPosField.hidden = aspectMatches || state.frame.mode !== 'fill';
}

// --- Controls --------------------------------------------------------------

function populateAlgorithms(): void {
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const option of DITHER_OPTIONS) {
    let group = groups.get(option.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = option.group;
      groups.set(option.group, group);
      dom.algorithm.append(group);
    }
    const item = document.createElement('option');
    item.value = option.id;
    item.textContent = option.label;
    group.append(item);
  }
  dom.algorithm.value = state.dither.algorithm;
}

function updateDitherControls(): void {
  const option = findDitherOption(state.dither.algorithm);
  dom.serpentine.disabled = !option.usesSerpentine;
  dom.serpentine.closest('label')?.classList.toggle('muted', !option.usesSerpentine);
  dom.seedField.hidden = !option.usesSeed;
}

function setStatus(message: string, kind: 'ok' | 'err' | null): void {
  dom.saveStatus.textContent = message;
  dom.saveStatus.classList.toggle('ok', kind === 'ok');
  dom.saveStatus.classList.toggle('err', kind === 'err');
}

function applyZoom(): void {
  // The stage grid sizes its columns from --zoom (see style.css), so this has
  // to be published to CSS as well as applied to each canvas.
  document.documentElement.style.setProperty('--zoom', String(state.zoom));
  for (const preview of Object.values(previews)) preview.setZoom(state.zoom);
}

function wireControls(): void {
  dom.pickFile.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', () => {
    const file = dom.fileInput.files?.[0];
    if (file) void loadFile(file);
    // Clear so re-picking the same file fires change again.
    dom.fileInput.value = '';
  });

  dom.zoom.addEventListener('change', () => {
    state.zoom = Number(dom.zoom.value);
    applyZoom();
  });

  // Stage 1
  for (const radio of dom.fitModes.querySelectorAll<HTMLInputElement>('input[name="fit"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.frame.mode = radio.value as FitMode;
      updateFrameControls();
      invalidate(STAGE_FRAME);
    });
  }
  dom.cropPos.addEventListener('input', () => {
    state.frame.cropPos = Number(dom.cropPos.value);
    dom.cropPosOut.textContent = `${state.frame.cropPos}%`;
    invalidate(STAGE_FRAME);
  });

  // Stage 3
  dom.blackPoint.addEventListener('input', () => {
    state.levels.blackPoint = Number(dom.blackPoint.value);
    // Keep at least one level between the points so the mapping has an interior.
    if (state.levels.blackPoint >= state.levels.whitePoint) {
      state.levels.whitePoint = Math.min(255, state.levels.blackPoint + 1);
      dom.whitePoint.value = String(state.levels.whitePoint);
      // The black point cannot exceed 254 without pushing white past the end.
      state.levels.blackPoint = state.levels.whitePoint - 1;
      dom.blackPoint.value = String(state.levels.blackPoint);
    }
    syncLevelOutputs();
    invalidate(STAGE_LEVELS);
  });
  dom.whitePoint.addEventListener('input', () => {
    state.levels.whitePoint = Number(dom.whitePoint.value);
    if (state.levels.whitePoint <= state.levels.blackPoint) {
      state.levels.blackPoint = Math.max(0, state.levels.whitePoint - 1);
      dom.blackPoint.value = String(state.levels.blackPoint);
      state.levels.whitePoint = state.levels.blackPoint + 1;
      dom.whitePoint.value = String(state.levels.whitePoint);
    }
    syncLevelOutputs();
    invalidate(STAGE_LEVELS);
  });
  dom.contrast.addEventListener('input', () => {
    state.levels.contrast = Number(dom.contrast.value);
    syncLevelOutputs();
    invalidate(STAGE_LEVELS);
  });
  dom.resetLevels.addEventListener('click', () => {
    state.levels = { ...DEFAULT_LEVELS };
    dom.blackPoint.value = String(state.levels.blackPoint);
    dom.whitePoint.value = String(state.levels.whitePoint);
    dom.contrast.value = String(state.levels.contrast);
    syncLevelOutputs();
    invalidate(STAGE_LEVELS);
  });

  // Stage 4
  dom.algorithm.addEventListener('change', () => {
    state.dither.algorithm = dom.algorithm.value as DitherId;
    updateDitherControls();
    invalidate(STAGE_DITHER);
  });
  dom.serpentine.addEventListener('change', () => {
    state.dither.serpentine = dom.serpentine.checked;
    invalidate(STAGE_DITHER);
  });
  dom.invert.addEventListener('change', () => {
    state.dither.invert = dom.invert.checked;
    invalidate(STAGE_DITHER);
  });
  dom.seed.addEventListener('input', () => {
    state.dither.seed = Number(dom.seed.value);
    dom.seedOut.textContent = String(state.dither.seed);
    invalidate(STAGE_DITHER);
  });

  // Save / verify
  dom.save.addEventListener('click', () => {
    if (!mono) return;
    void (async () => {
      try {
        const outcome = await saveOffimg(mono, dom.filename.value);
        if (outcome === 'cancelled') {
          setStatus('', null);
        } else {
          const name = ensureBmpExtension(dom.filename.value);
          setStatus(
            outcome === 'saved' ? `Saved ${name}.` : `Downloaded ${name} to your downloads folder.`,
            'ok',
          );
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'err');
      }
    })();
  });

  dom.verify.addEventListener('click', () => {
    if (!mono) return;
    void (async () => {
      dom.verify.disabled = true;
      try {
        const result = await verifyOffimg(mono);
        setStatus(result.message, result.ok ? 'ok' : 'err');
      } finally {
        dom.verify.disabled = false;
      }
    })();
  });
}

function syncLevelOutputs(): void {
  dom.blackOut.textContent = String(state.levels.blackPoint);
  dom.whiteOut.textContent = String(state.levels.whitePoint);
  dom.contrastOut.textContent =
    state.levels.contrast > 0 ? `+${state.levels.contrast}` : String(state.levels.contrast);
}

function wireDropAndPaste(): void {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  for (const type of ['dragenter', 'dragover'] as const) {
    document.addEventListener(type, (event) => {
      stop(event);
      dom.dropzone.classList.add('dragover');
    });
  }
  for (const type of ['dragleave', 'dragend'] as const) {
    document.addEventListener(type, (event) => {
      stop(event);
      if (event.target === dom.dropzone || event.target === document.body) {
        dom.dropzone.classList.remove('dragover');
      }
    });
  }

  document.addEventListener('drop', (event) => {
    stop(event);
    dom.dropzone.classList.remove('dragover');
    const file =
      firstImageFile(event.dataTransfer?.files ?? null) ??
      firstImageFile(event.dataTransfer?.items ?? null);
    if (file) void loadFile(file);
    else setStatus('That drop did not contain an image file.', 'err');
  });

  dom.dropzone.addEventListener('click', () => dom.fileInput.click());

  document.addEventListener('paste', (event) => {
    const file = firstImageFile(event.clipboardData?.items ?? null);
    if (file) {
      event.preventDefault();
      void loadFile(file);
    }
  });
}

// --- Init ------------------------------------------------------------------

populateAlgorithms();
updateDitherControls();
wireControls();
wireDropAndPaste();
syncLevelOutputs();
applyZoom();
drawCurve(dom.curve, buildLevelsLut(state.levels));
