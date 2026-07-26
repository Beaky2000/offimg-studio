# OFFIMG Studio

Turn any image into a **SwissMicros DM42 OFFIMG** — the picture your calculator shows
while it is switched off.

**→ [Open the app](https://USER.github.io/offimg-studio/)** *(update this link after your
first Pages deploy)*

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
- Prefer to be fully offline? Grab `dist/index.html` from a build and open it from your
  own disk.

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
3. **Tone** — black point, white point, and a contrast slider that applies an
   endpoint-preserving S-curve.
4. **Dither** — thirteen algorithms, error-diffusion and ordered, from Tanner Helland's
   [survey of dithering
   algorithms](https://tannerhelland.com/2012/12/28/dithering-eleven-algorithms-source-code.html):
   Floyd–Steinberg, False Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Atkinson,
   Burkes, Sierra-3, Sierra-2, Sierra Lite, plus threshold, random, and Bayer 4×4 / 8×8.
   Error diffusion can run in serpentine (boustrophedon) scan order.

Previews are drawn with nearest-neighbour scaling at integer zoom levels — a dither
pattern viewed through a smoothing filter is a lie, and the pattern is the whole point.

## Build it yourself

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
git clone https://github.com/USER/offimg-studio.git
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

`npm run build` type-checks and writes a self-contained static site to `dist/`, which is
all GitHub Pages needs.

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
