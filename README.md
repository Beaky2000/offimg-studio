# OFFIMG Studio

Turn any image into a **SwissMicros DM42 OFFIMG** — the picture your calculator shows
while it is switched off.

**→ [Open the app](https://beaky2000.github.io/offimg-studio/)**

Output is a 400×240, 1-bit, `BITMAPINFOHEADER` ("Windows NT") BMP — exactly what the
DM42 requires. Copy it into the `/OFFIMG/` folder on the calculator's USB disk and power
the unit off.

## Why you can run this without trusting me

- **It is a web page, not a program.** It runs in your browser's sandbox. There is
  nothing to install and nothing to grant permission to.
- **Your image never leaves your machine.** Every stage — decoding, scaling, grayscale
  conversion, dithering, BMP encoding — happens in JavaScript on your own computer.
  The app makes **no network requests at all** after the page has loaded. Open your
  browser's Network tab and watch it stay empty while you work.
- **No third-party runtime code.** Zero runtime dependencies; the only build-time tools
  are TypeScript and Vite. Nothing you didn't read gets shipped.
- **Read the source two ways.** Browse this repository, or just press F12 on the live
  page — the deployed bundle ships source maps.
- **Prefer to be fully offline?** A build produces one self-contained
  `dist/index.html` — all CSS and JavaScript inlined, no other files, about 27 kB.
  Download it, read the whole thing, then double-click it. No server needed.

## The pipeline

Each stage shows its own preview, and every control updates the final dithered result
live.

1. **Frame** — scale to 400×240. If the source aspect ratio isn't 5:3 you choose *fill*
   (crop, with a slider to steer *which* part is cropped), *fit over white*, or
   *fit over black*.
2. **Grayscale** — converted with correct **linear intensity**: gamma is decoded, the
   Rec.709 luma weights (0.2126 / 0.7152 / 0.0722) are applied in linear light, and the
   result is re-encoded. This is meaningfully different from the naive weighted average
   most tools use — see [Gamma-Correct Grayscale
   Conversion](https://entropymine.com/imageworsener/grayscale/).
3. **Tone** — black point, white point, a contrast slider that applies an
   endpoint-preserving S-curve, and a brightness slider that applies a gamma curve to lift
   or lower the midtones (gamma 1.00 is neutral). Gamma is applied after the S-curve, so
   the midtone lands where the brightness slider says regardless of the contrast setting.
   Black and white are never disturbed by either.
4. **Dither** — thirteen algorithms, error-diffusion and ordered, from Tanner Helland's
   [survey of dithering
   algorithms](https://tannerhelland.com/2012/12/28/dithering-eleven-algorithms-source-code.html):
   Floyd–Steinberg, False Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Atkinson,
   Burkes, Sierra-3, Sierra-2, Sierra Lite, plus threshold, random, and Bayer 4×4 / 8×8.
   Error diffusion can run in serpentine (boustrophedon) scan order.

Previews are drawn with nearest-neighbour scaling — a dither pattern viewed through a
smoothing filter is a lie, and the pattern is the whole point. Zoom is measured in
**device pixels per image pixel**, not CSS pixels, so every pixel stays exactly the same
size whatever your Windows display scale is set to. At a fractional scale such as 125% the
naive approach would ask for 2.5 device pixels per image pixel and the browser would round
each one, leaving columns alternately 2 and 3 pixels wide and edges looking jagged. The
side effect is that the preview keeps its physical size rather than growing with the
display scale, so at 125% it looks smaller relative to the surrounding text — that is what
scaling to physical pixels means, and 4× is there when you want it larger.

## Build it yourself

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/Beaky2000/offimg-studio.git
cd offimg-studio
npm ci
npm run dev
```

Then open the URL it prints. Other commands:

```bash
npm run build
```

```bash
npm test
```

`npm run build` type-checks and writes a **single** self-contained file,
`dist/index.html`, with the CSS and JS inlined. That one file is both what GitHub Pages
serves and what you can open directly off disk.

The inlining is not a size optimisation — it is what makes `file://` work. Chrome applies
CORS to external `<script type="module">`, and a `file://` page has a null origin, so an
external bundle is blocked and never executes: the page would render but no button would
do anything. An inline module needs no fetch, so it runs. See `inlineEverything()` in
[vite.config.ts](vite.config.ts).

To serve the built file over HTTP instead:

```bash
npm run preview
```

To reach the dev server from another machine on your network (handy for checking pixel
rendering at a different display scaling):

```bash
npm run dev:host
```

To regenerate the test images in `samples/` (a gray ramp, a step wedge, saturated colour
bars and fine diagonal lines, at three different aspect ratios):

```bash
node scripts/make-samples.mjs
```

### About the BMP tests

`samples/reference-header.bin` is the 62-byte header of a genuine OFFIMG copied off a
DM42 — file header, info header and colour table, with no pixel data. The test suite
asserts our encoder reproduces it byte for byte, which is what pins down black/white
polarity, bottom-up row order, the 4-byte row padding and every header field. Only the
header is committed, because the stock off-images themselves are SwissMicros' artwork.

If you drop a complete off-image at `samples/reference-offimg.bmp`, two further tests
round-trip its pixel data through the encoder as well.

## License

MIT — see [LICENSE](LICENSE).
