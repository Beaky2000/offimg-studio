# OFFIMG Studio — plan and status

**Status: v1 implemented.** 105 tests pass; the encoder is verified byte-for-byte against
a genuine OFFIMG header; the pipeline has been exercised in a real browser. The one thing
still outstanding is a hardware check (see *Remaining*).

## Context

SwissMicros DM42/DM42n calculators show a custom image while powered off. It must be a
400×240, 1-bit, "Windows NT" BMP (plain 40-byte `BITMAPINFOHEADER`) placed in `/OFFIMG/`
on the calculator's USB disk. The existing route — GIMP: scale → Indexed → 1-bit palette
→ Floyd–Steinberg — works but is fiddly, gives no control over grayscale conversion or
tone mapping, and offers one dither algorithm chosen blind.

This is a purpose-built tool: a live four-stage pipeline (frame → grayscale → tone →
dither) with instant feedback and correct BMP output, shareable with forum users **who
will not run an unknown binary**.

That trust constraint drove the stack choice, not performance. The compute is negligible:
400×240 = 96,000 pixels, every stage O(n). So: **static client-side web app, TypeScript +
Vite, free on GitHub Pages.** Nothing to install, browser sandbox, source on GitHub *and*
readable in devtools. Zero runtime dependencies.

## Layout

```
index.html                     single page, all four stages visible
vite.config.ts                 base './' → works on Pages AND file://
.github/workflows/deploy.yml   npm ci → test → build → deploy-pages
scripts/make-samples.mjs        generates samples/ test cards
src/
  main.ts                      state, dirty tracking, rAF-coalesced recompute
  style.css
  io/bmp1.ts                   1-bit BMP encoder + minimal decoder
  io/decode.ts                 file / drop / paste → ImageBitmap
  io/save.ts                   save dialog or download, plus output verification
  pipeline/frame.ts            fill / fit → RGBA 400×240
  pipeline/gray.ts             linear-intensity grayscale
  pipeline/levels.ts           black/white point + contrast
  pipeline/dither.ts           dispatcher
  pipeline/dither/matrices.ts       error-diffusion kernels
  pipeline/dither/errorDiffusion.ts generic engine, serpentine option
  pipeline/dither/ordered.ts        threshold, seeded random, Bayer 4/8
  ui/preview.ts                canvas previews + tone curve plot
test/                          bmp1, pipeline, referenceOffimg
```

## Pipeline

Each stage caches its output. A control change marks its stage dirty and recomputes from
there, coalesced into one `requestAnimationFrame`. No debouncing — measured cost is well
inside a frame.

**1 — Frame.** Target 5:3. Sources within 0.5% count as an exact match (real images are
often a pixel or two off from a resize) and skip the mode choice entirely. Otherwise:
*fill* (cover + crop, with a slider steering which part is cut), *fit over white*, or
*fit over black*. Geometry is a pure function, `computeDrawRect`, so it is tested without
a DOM. Large reductions are done by successive halving before the final `drawImage`,
because a single big downscale aliases and dithering then amplifies that into pattern
noise.

**2 — Grayscale, linear intensity.** `gray = (0.2126·R^2.2 + 0.7152·G^2.2 +
0.0722·B^2.2)^(1/2.2)`, via a 256-entry decode LUT. Mixing in linear light rather than on
gamma-encoded bytes is the whole point; the primaries come out 126/219/77 instead of the
naive 54/182/18.

**3 — Tone.** A 256-entry LUT built from black point, white point and contrast, so a
slider drag costs 256 operations plus one indexed read per pixel. Contrast uses the
endpoint-preserving `gain` curve, `k = 2^(slider/50)`: `k = 1` is exactly the identity,
`k > 1` is an S-curve, `k < 1` flattens, and 0 and 255 stay pinned so raising contrast
can never move the points the user just set.

**4 — Dither.** One generic error-diffusion engine parameterised by taps + divisor +
serpentine flag, covering Floyd–Steinberg, False Floyd–Steinberg, Jarvis–Judice–Ninke,
Stucki, Atkinson, Burkes, Sierra-3, Sierra-2 and Sierra Lite. Plus threshold, random and
Bayer 4×4/8×8 — thirteen in total. Random dither uses a **seeded** xorshift, not
`Math.random`, so the preview does not crawl when unrelated controls move and the saved
file matches what is on screen. Inversion is applied here, not in the encoder, so preview
and file always agree.

Previews use a 400×240 backing store scaled in CSS at integer zoom with
`image-rendering: pixelated`. Smoothing would misrepresent the dither pattern, which is
the one thing the user is judging.

## BMP output

Plain 14-byte `BITMAPFILEHEADER` + 40-byte `BITMAPINFOHEADER`, `BI_RGB`, 1 bpp, positive
height (bottom-up rows), 50 bytes of pixels per 52-byte row, 2-entry palette with black
at index 0. File size 12,542 bytes.

Verified against a real off-image: **all 62 header bytes match**, including
`biClrUsed`/`biClrImportant` = 0 (not 2 — both are legal, but matching a file the
firmware demonstrably accepts leaves no room for doubt) and the zeroed resolution fields.

## Measured performance

Per full recompute at 400×240, buffers reused (Chromium, this machine):

| Path | Cost |
|---|---|
| Stage 1 frame (1000×400 source) | 0.66 ms |
| Stage 2 grayscale | 1.40 ms |
| Stage 3 tone (LUT rebuild + apply) | 0.09 ms |
| Stage 4 Floyd–Steinberg / Jarvis / Bayer 8 | 1.99 / 4.60 / 0.27 ms |
| **Tone slider drag** (stages 3–4, worst kernel) | **4.7 ms** |
| **Crop slider drag** (all four stages) | **6.8 ms** |

Both comfortably inside a 16.7 ms frame, so sliders are live.

## Verification performed

- 105 unit tests: header bytes and row padding; grayscale primaries; LUT identity and
  monotonicity; `gain` endpoints; every dither kernel binary-valued and preserving pure
  black and pure white; a hand-computed Floyd–Steinberg step; mean preservation for the
  error-diffusing kernels; determinism of seeded random.
- Encoder reproduces a genuine OFFIMG header byte for byte, and re-encodes a whole real
  off-image to a byte-identical file.
- In-browser: all three sample aspect ratios framed correctly in all three modes; the
  encoded BMP re-decoded via `createImageBitmap` (the browser's own decoder, independent
  of ours) round-trips all 96,000 pixels exactly.
- UI wiring: aspect-mismatch detection, fit-mode notes, tone-slider mutual clamping,
  algorithm-dependent controls, zoom, reset.
- Tests pass both with and without the optional reference image, so CI stays green on a
  fresh clone.

## Remaining

1. **Hardware check** — copy an output to `/OFFIMG/` on a DM42 and power it off, to
   confirm it displays and is not inverted. Everything points to the polarity being
   right, but only the calculator can settle it.
2. Replace the `USER` placeholders in `README.md` and `index.html` with the real GitHub
   account, then enable Pages (Settings → Pages → Source: GitHub Actions).

## Deliberate simplifications

- Stage 1 downscaling happens in gamma space; a linear-light box filter would be more
  correct but means hand-rolling resampling.
- Dithering thresholds gamma-encoded values, as the classic algorithms do.
- No colour-channel filters before grayscale, no rotate-90°, no unsharp mask, no settings
  persistence — all noted as possible later additions.
