# OFFIMG Studio — plan and status

**Status: v1 complete and confirmed on hardware.** 105 tests pass; the encoder is verified
byte-for-byte against a genuine OFFIMG header; the pipeline has been exercised in a real
browser; and output has been displayed on a real DM42 with correct black/white polarity.
Only the GitHub publishing steps remain (see *Remaining*).

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
vite.config.ts                 base './' + inlineEverything() → single-file build
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

Previews are sized in **device pixels**, not CSS pixels: the backing store is
`400·scale × 240·scale`, the frame is blitted into it with smoothing off (an exact integer
nearest-neighbour expansion), and the CSS size is `backing / devicePixelRatio` so backing
pixels land 1:1 on device pixels. Each image pixel therefore covers exactly
`scale × scale` device pixels at any OS display scale.

The naive approach — one 400×240 canvas scaled up in CSS with `image-rendering: pixelated`
— only looks right at 100%. At 125% the ratio is 1.25, so a 2× zoom asks for 2.5 device
pixels per image pixel; the browser rounds each one and columns come out alternately 2 and
3 device pixels wide, which reads as jagged edges and unevenly sized pixels. Fatal for a
tool whose entire job is judging that pattern.

Accepted trade-off: the preview keeps its physical size instead of growing with the display
scale, so at 125% it appears smaller relative to the surrounding text. A 4× zoom level
exists to compensate. `devicePixelRatio` changes (moving the window between monitors,
changing the scale while the page is open) are picked up via a re-armed `(resolution: …dppx)`
media query.

## BMP output

Plain 14-byte `BITMAPFILEHEADER` + 40-byte `BITMAPINFOHEADER`, `BI_RGB`, 1 bpp, positive
height (bottom-up rows), 50 bytes of pixels per 52-byte row, 2-entry palette with black
at index 0. File size 12,542 bytes.

Verified against a real off-image: **all 62 header bytes match**, including
`biClrUsed`/`biClrImportant` = 0 (not 2 — both are legal, but matching a file the
firmware demonstrably accepts leaves no room for doubt) and the zeroed resolution fields.

## Distribution

The build emits a **single** self-contained `dist/index.html` (~27 kB) via a ~30-line
`inlineEverything()` plugin in `vite.config.ts`, rather than pulling in
`vite-plugin-singlefile`. One artifact covers both routes: what GitHub Pages serves, and
what a sceptical user can download, read end to end and run offline.

Inlining turned out to be **required, not optional**. Chrome applies CORS to external
`<script type="module">`, and a `file://` page has a null origin, so an external bundle is
blocked and silently never executes — the page renders but no control responds. Relative
asset paths (`base: './'`) are necessary for `file://` but not sufficient. The plugin
fails the build if any subresource reference survives, so that failure cannot return
unnoticed.

`npm run dev` stays bound to localhost; `npm run dev:host` exposes the dev server on the
LAN. Note this machine's Domain firewall profile has explicit inbound Block rules for
Node.js, so LAN access needs an IT-policy change — copying `dist/index.html` is the
practical way to view the app on another machine.

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

## Confirmed on hardware

- Output displays correctly on a real DM42: **black and white are the right way round**
  with no inversion needed. Palette index 0 = black, a set bit = white, which is what the
  reference header already implied. The polarity question is closed.
- The `Invert output` control is therefore **not** a polarity escape hatch. It is kept as a
  creative option, since a negative can read better than a positive on a bilevel LCD,
  particularly for line art and text.
- Previews look correct at 100%, 125% and 150% Windows display scale. The residual concern
  about a fractional element position softening the image at 150% did not materialise, so
  no position snapping is needed.

## Remaining

1. Replace the `USER` placeholders in `README.md` and `index.html` with the real GitHub
   account, then enable Pages (Settings → Pages → Source: GitHub Actions).

## Deliberate simplifications

- Stage 1 downscaling happens in gamma space; a linear-light box filter would be more
  correct but means hand-rolling resampling.
- Dithering thresholds gamma-encoded values, as the classic algorithms do.
- No colour-channel filters before grayscale, no rotate-90°, no unsharp mask, no settings
  persistence — all noted as possible later additions.
