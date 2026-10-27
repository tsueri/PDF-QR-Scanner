# Browser image decoding: formats, orientation, and very large photos

Research for [#20](https://github.com/tsueri/PDF-QR-Scanner/issues/20), child of the map [#18](https://github.com/tsueri/PDF-QR-Scanner/issues/18). Planning input only; no app code was changed.

Date: 2026-10-27. Repo state: `origin/main` @ `578cf02`, `zxing-wasm` 3.1.5 (pinned zxing-cpp commit `2ecec3f5be0e`, 2026-09-30).

## 1. Recommendation (decision-ready)

1. **Decode raster files in the worker, with `createImageBitmap(file)`.** The worker does `createImageBitmap(file)`, draws onto an `OffscreenCanvas` that is **pre-filled white**, calls `getImageData`, and passes the result to the existing `decodeImageData()`. `decode.js` and `WorkerPool` stay as they are, except for a new "decode this Blob" message type next to today's "scan this buffer" one. This works in Chromium 149 and Firefox 151 (measured). Per WebKit source, Safari shares the same `WindowOrWorkerGlobalScope.createImageBitmap`. A Safari run was not possible here.
2. **Keep the default `imageOrientation`.** All three engines default to "apply EXIF" (spec says `from-image`). zxing reads rotated and mirrored QR codes anyway, so orientation only matters for overlays and the reported `position`.
3. **Always flatten alpha onto white** before `getImageData`. Transparent pixels come back as `0,0,0,0`, which zxing reads as black. A transparent-background QR PNG or SVG then decodes to **zero results**. Measured: 0 found as-is, 1 found after flattening.
4. **Do not downscale by default.** zxing's wasm decoder is fast enough at full resolution, and its detector already builds a downscale pyramid. Full-res decode of a 48 MP photo takes about 0.5–1.6 s of wasm time. Pre-shrinking a 48 MP photo to 2000 px lost a 4.3 px/module QR; 3000 px found it.
5. **Gate by a pixel budget, not by exceptions.** Chromium returns a silently blank canvas above 16384² px. Peak memory on the bitmap path is about **15 bytes per source pixel** (about 0.7 GB for 48 MP, about 1.6 GB for 108 MP). The pool needs an in-flight pixel budget, not just a worker count.
6. **Over-budget ladder:**
   - (a) For JPEG/PNG/BMP/GIF, hand the Blob straight to zxing-wasm. It decodes with stb_image to 8-bit grey, about 2.8 B/px (5× less memory). It is about as fast as the bitmap path in Chromium and about 1.7× slower in Firefox, and it ignores EXIF (which is harmless for QR).
   - (b) Otherwise decode once to an `ImageBitmap` and slice tiles from the bitmap. Slicing 24 tiles of a 48 MP bitmap takes about 0.4 s. Cropping from the Blob (`createImageBitmap(blob, sx, sy, sw, sh)`) re-decodes the whole file per tile and takes 4–6 s.
   - (c) If downscaling is unavoidable, keep the long side at **≥ 3000 px** and label the result "downscaled".
7. **SVG must be rasterised on the main thread** with `<img>` + `drawImage(img, 0, 0, W, H)`. `createImageBitmap(svgBlob)` fails in both Chromium and Firefox, in a window and in a worker. `createImageBitmap(<img svg>)` is also unreliable (blank in Chromium for viewBox-only SVGs). Choose `W×H` yourself (about 3000 px long side), using the `<img>`'s natural aspect ratio. `<img>` decoding is safe against scripts and external fetches (verified). One Chromium quirk: a `foreignObject` taints the canvas when loaded from a `blob:` URL but not from a `data:` URL.
8. **Not natively decodable, so no work without extra code:** TIFF (Safari only), HEIC/HEIF (Safari 17+ only), JPEG XL (very new and partial). `ImageDecoder` (WebCodecs) adds nothing for this app; skip it.

## 2. How this was researched

- **Primary sources:** the WHATWG HTML spec (`createImageBitmap`), MDN pages and `@mdn/browser-compat-data` v8.1.7 (npm), the WebKit source on GitHub, the zxing-cpp source at the exact commit pinned by zxing-wasm 3.1.5, zxing-wasm's source and docs, and stb_image.h. MDN BCD is the MDN-maintained compatibility dataset. URLs are in §11.
- **Measured here:** Playwright 1.61.0 driving **Chromium 149.0.7827.55** and **Firefox 151.0** on Linux x86-64 (22 cores, 30 GB), headless. Test images were generated with `sharp`, and QR codes with `qrcode`. Experiments lived under `/tmp/opencode/exp` and are not committed. Timings are desktop numbers; budget **3–5× slower on phones** (an assumption, not measured).
- **Not measured:** WebKit/Safari. The Playwright WebKit build could not start (missing host libraries), and there was no iOS device. Every Safari statement below is from BCD or WebKit source and is labelled as such.

## 3. Format and API support

### 3.1 Measured: Chromium 149 and Firefox 151 (identical results)

Each format was tested through `createImageBitmap(blob)` on the main thread and in a **dedicated worker**, `<img>.decode()` + `drawImage`, and `ImageDecoder`. A coloured marker image checked pixel positions.

| Format | `createImageBitmap(Blob)` (window and worker) | `<img>.decode()` + canvas | `ImageDecoder` | Notes |
|---|---|---|---|---|
| PNG | ✅ | ✅ | ✅ | |
| JPEG (baseline and progressive) | ✅ | ✅ | ✅ | EXIF orientation applied everywhere (§4) |
| WebP (incl. animated) | ✅ | ✅ | ✅ | First frame only for bitmap/img |
| AVIF | ✅ | ✅ | ✅ | |
| GIF (animated) | ✅ | ✅ | ✅ | `createImageBitmap` and `<img>` give **frame 0**; `ImageDecoder` exposes all frames |
| BMP (24-bit) | ✅ | ✅ | ✅ | |
| TIFF | ❌ `InvalidStateError` | ❌ `EncodingError` | ❌ `isTypeSupported` false | |
| SVG | ❌ `InvalidStateError` (even with explicit width/height) | ✅ main thread only | ❌ | See §6 |
| HEIC | not testable (no encoder) | | | |

The result is the same in a worker for every raster format that works on the main thread. `createImageBitmap(Blob)` sniffs content instead of trusting the MIME type: a PNG labelled `image/jpeg` decodes.

### 3.2 Safari and mobile: BCD only, not tested here

| Feature | Chrome | Firefox | Safari | iOS Safari |
|---|---|---|---|---|
| `createImageBitmap` | 50 | 42 | 15 | 15 |
| `imageOrientation` option | 52 | 93 | 15 | 15 |
| `resizeWidth`/`resizeHeight` | 54 | 98 | 15 | 15 |
| `resizeQuality` | 54 | **149** | 15 | 15 |
| `OffscreenCanvas` 2D context (and `getImageData`) | 69 | 105 | **16.4** | **16.4** |
| `ImageDecoder` | 94 | 133 | "preview" | false |
| `<img>.decode()` | 64 | 68 | 11.1 | 11.3 |
| Image format `image/webp` | 17 | 65 | 14 | 14 |
| Image format `image/avif` | 85 | 93 | 16.4 (partial on 16.1 macOS) | 16.1 |
| Image format `image/heif` | no | no | **17** | **17** |
| Image format `image/tiff` | no | no | yes | yes |
| Image format `image/jxl` | 155 | 158 | 17 (no animation) | 17 |

Android Chrome and Firefox match their desktop versions in BCD.

- **Worker `createImageBitmap` in Safari** could not be run. WebKit declares `createImageBitmap` in `WindowOrWorkerGlobalScope.idl`, and its `ImageBitmap.cpp` has a Blob path built on `FileReaderLoader`. That is source evidence, not a run.
- **Safari floor for the worker pipeline** is 16.4, because of `OffscreenCanvas`. Below that, `scan.js` already falls back to main-thread canvas (`supportsOffscreen` check). Keep that fallback.

### 3.3 The second decode path: zxing-wasm `readBarcodes(Blob)`

`zxing-wasm` accepts `Blob | ArrayBuffer | Uint8Array | ImageData`. A Blob goes through **stb_image inside wasm** (`readBarcodesFromImage` in `ZXingWasm.cpp`, `stbi_load_from_memory(..., 1)`). It decodes straight to one grey channel and never touches a canvas.

- **Format coverage (stb_image header):** JPEG baseline and progressive, PNG (1–16 bit), BMP (non-1bpp, non-RLE), GIF (first frame), plus PSD/TGA/HDR/PIC/PNM. It has **no WebP, AVIF, SVG, TIFF or HEIC**, and **no EXIF handling**.
- **Measured behaviour:** it worked for 12–200 MP JPEGs in Chromium and Firefox workers. Total time was about equal to the bitmap path in Chromium (faster above 100 MP) and about 1.7× slower in Firefox (§7.2).
- **Value:** it removes the browser canvas size limits (§7.1) and cuts peak memory about 5×. That makes it a good over-budget fallback, especially on iOS.

## 4. EXIF orientation and colour

- **Spec:** the HTML spec defines `imageOrientation` as `"from-image"` (default) | `"flipY"`. It says `"none"` was renamed to `"from-image"` and will be re-added later with a different meaning. MDN still lists `none` as the "ignore EXIF" mode.
- **Measured (Chromium 149, Firefox 151):** all 8 EXIF orientations are applied identically by `createImageBitmap` (default, `'from-image'` and even `'none'`), `<img>`, `ImageDecoder` and the worker. Orientations 5–8 swap width and height. **`imageOrientation: 'none'` does not turn EXIF off** in either browser, so there is no way to get the raw stored pixels this way.
- **WebKit source:** `ImageBitmapOptions` defaults to `FromImage`. Its IDL accepts `"none"` but `resolvedImageOrientation()` leaves the image's orientation untouched, so it behaves the same.
- **What breaks:** nothing for decoding. zxing-cpp reads mirrored and rotated QR codes. Tested on a `qrcode` PNG after flop, flip, rot90, transpose and rot180 (the pixel effect of EXIF 2–8): all decoded, with `isMirrored` and `orientation` reported. The stb Blob path ignores EXIF, which is therefore harmless for 2D codes. Orientation only matters for the *shape and coordinates* of `position`: if a results view draws overlays on a preview, the preview must use the same oriented pixels the decoder saw. Rotating the preview independently would put the overlay in the wrong place.
- **Colour space:** `colorSpaceConversion: "default"` is implementation-specific, and `"none"` ignores embedded ICC profiles (spec text). Barcodes are effectively monochrome, so this does not affect decoding. `getImageData` returns sRGB by default. Not worth any option.
- **Alpha (important):** ImageData from a transparent PNG/WebP/SVG has `(0,0,0,0)` in transparent areas. The decoder converts to luminance and ignores alpha, so a "dark modules on transparent background" code looks black everywhere. **Measured:** zxing found 0 codes in the raw RGBA and 1 after compositing on white. Chromium and Firefox both return `[0,0,0,0]` for the transparent corner after `drawImage` onto a fresh canvas. **Fix:** `fillStyle = '#fff'; fillRect(...)` before `drawImage`. The PDF flow presumably does not hit this, because pdf.js paints a page background.
- **Safari privacy noise:** WebKit can inject canvas noise on readback (`CanvasNoiseInjection.cpp`, enabled by `NoiseInjectionPolicy`). The code adjusts channels by about ±1–3 of 255 (its comments say ~0.5–1 %). That is negligible for binarisation. Not worth handling, but worth knowing if Safari private-mode results ever look odd.

## 5. Practical guidance: finding a small QR in a huge photo

### 5.1 What zxing-cpp actually does (source at pinned commit `2ecec3f5be0e`)

From `ReadBarcode.cpp`, `ReaderOptions.h` and `QRDetector.cpp`:

- **Pyramid.** `ReadBarcodes` builds a `LumImagePyramid` and scans **every layer**: full-res first, then the image averaged down by `downscaleFactor` (default 3) while `max(width, height) > downscaleThreshold` (default 500). For 8000×6000 the layers are 8000×6000, 2666×2000, 888×666, 296×222. For 4000×3000 they are 4000×3000, 1333×1000, 444×333. Positions from smaller layers are scaled back to full-res coordinates. **The header comment documents the threshold as `min(width, height)`, but the code compares `max(width, height)`.**
- **No early exit by default.** Each layer is tried in both normal and inverted polarity (`tryInvert`, default on). It only returns early when `maxNumberOfSymbols` is reached. The default is 255, so a hit on layer 0 still scans the lower layers. Hence the roughly 2× cost of default `tryDownscale` over `tryDownscale: false`.
- **Binariser.** Default is `LocalAverage` (a hybrid, block-based binariser). The pyramid exists in part because large modules (tens of pixels per module) binarise poorly at full resolution. See the "QR 1500 px" row below.
- **`tryHarder`** (already `true` in `decode.js`) changes how rows are scanned for finder patterns in QR. Without it, the row skip is `(3·height)/(4·97)`: about 23 rows at 3000 px height. With it, the skip is 3 rows. This is **the** setting that finds small codes in big images.
- **`tryRotate`** is only read by the 1D, DataMatrix and PDF417 readers. **QR ignores it.** QR detection is rotation-invariant by construction.
- **`tryDownscale`** is read only by the pyramid above. `downscaleThreshold` and `downscaleFactor` tune it.
- zxing-cpp rejects images above 65535 px per side only when `PatternType` is smaller than 4 bytes, so that limit is not hit by browser-sized input.

### 5.2 Experiments (decode time in Node, 22-core desktop; JPEG q85, QR rotated about 12° except the 1500 px one, with blur)

Found counts are for `formats: ['QRCode']`, `tryHarder: true` unless stated. "px/mod" is the module size in source pixels.

| Scene | Source QR | Full-res default | Full-res, `tryDownscale:false` | Full-res, `tryHarder:false` **and** `tryDownscale:false` | Pre-shrunk long side that still found it |
|---|---|---|---|---|---|
| 4000×3000 (12 MP) | 200 px, ≈5 px/mod | 1 found, 203 ms | 1, 107 ms | **0** | ≥ 1200 |
| 4000×3000 | 120 px, ≈3 px/mod | 1, 116 ms | 1, 58 ms | **0** | ≥ **2000** (1600 fails) |
| 4000×3000 | 1500 px, ≈40 px/mod | 1, 112 ms | 1, 57 ms | 1 | all ≥ 800 with defaults; **2000 with `tryDownscale:false` fails** |
| 8000×6000 (48 MP) | 300 px, ≈7 px/mod | 1, 483 ms | 1, 241 ms | **0** | ≥ 1600 |
| 8000×6000 | 150 px, ≈4.3 px/mod | 1, 455 ms | 1, 233 ms | **0** | ≥ **3000** (2000 fails) |

`tryHarder:false` with the default pyramid found the 200 px QR in the 12 MP photo but missed the other small ones (120 px, and both 48 MP scenes).

Findings:
- **Rule of thumb:** after any pre-shrink, the smallest code needs about **≥ 2 px per module**. In the last row, 3000 px of 8000 leaves about 1.6 px/mod and still decoded; 2000 px (about 1.1) did not. Keeping the long side at **≥ 3000 px** is a safe floor for photos where the code is small (about 2 % of the frame).
- **Full-res is cheap enough.** The wasm decode of a 48 MP image is 0.2–0.6 s in Node.

Browser end-to-end, in a worker (decode from `File` → bitmap → canvas → `getImageData` → `readBarcodes`), found counts and total ms. "Multi" = try 2000 px first, then full-res if nothing found.

| Scene | Chromium full | Chromium downscale 2000 | Chromium multi | Firefox full | Firefox downscale 2000 | Firefox multi |
|---|---|---|---|---|---|---|
| 12 MP, 200 px QR | 1, 354 ms | 1, 309 | 1, 295 | 1, 699 | 1, 424 | 1, 424 |
| 12 MP, 120 px QR | 1, 325 | 1, 293 | 1, 322 | 1, 741 | 1, 428 | 1, 442 |
| 48 MP, 300 px QR | 1, 1130 | 1, 639 | 1, 636 | 1, 1989 | 1, 957 | 1, 936 |
| 48 MP, 150 px QR | 1, 1103 | **0**, 670 | 1, 1758 | 1, 1922 | **0**, 855 | 1, 2740 |

**Where the time goes:** on a 48 MP photo about half is decode-to-pixels. That cost is the same whether or not you resize, because `createImageBitmap(blob, {resizeWidth})` still decodes the whole file (measured 151–277 ms for resize vs 78–238 ms for plain decode). A cheap coarse pass therefore does **not** save the expensive part. It only saves wasm time, and it adds 0.6–1.4 s when it misses. **A multi-scale retry is not worth it for QR.** Decode once at full resolution and let zxing's pyramid handle the scales.

### 5.3 Tiling

- **When:** only if memory forces it (§7.2), not for detection quality.
- **How:** decode **once** to an `ImageBitmap`, then `createImageBitmap(bitmap, sx, sy, sw, sh)` per tile. 24 tiles of 2048² with 25 % overlap, including `getImageData`, took **0.35–0.4 s** in Chromium and Firefox.
- **Do not** crop from the Blob: `createImageBitmap(blob, sx, sy, sw, sh)` took **4.4–6.0 s** for the same 24 tiles on a 48 MP JPEG (about 0.2 s per tile, i.e. one full decode per tile). That also costs more than the single full-res decode (about 1.1–2.0 s).
- Tiles must overlap by at least a code size, or a code on a seam is lost. Positions must be translated back by the tile offset, and duplicates deduped by payload (`orderAndDedupeCodes` already dedupes exact payloads).

## 6. SVG

- **Not decodable through `createImageBitmap(Blob)`** in Chromium 149 or Firefox 151, main thread or worker, even for an SVG with explicit width/height (`InvalidStateError`). The HTML spec's own Blob path says a vector graphic with no natural size must be rejected, and implementations reject the rest too. SVG goes through an `<img>`, so **it is a main-thread-only path** (`Image` is not available in workers).
- **Do not use `createImageBitmap(<img svg>)` as the shortcut.** With `resizeWidth/Height`, a `viewBox`-only SVG came back **blank (0 red pixels, no error)** in Chromium. Without resize it throws `InvalidStateError`. Firefox gave 300×150 for a viewBox-only 300×200 SVG when no resize was passed. `drawImage(img, 0, 0, W, H)` onto a canvas was correct in both engines.
- **Raster size selection.** SVG is vector, so any size is free. Drawing at the destination rectangle is crisp: 4× scale gave exactly 16× the red pixels, no soft edges, in both engines. Natural-size fallbacks differ between engines:

  | SVG | Chromium natural size | Firefox natural size |
  |---|---|---|
  | `width=300 height=200` | 300×200 | 300×200 |
  | `viewBox="0 0 300 200"` only | **225×150** | **300×200** |
  | `width/height=100%` + viewBox | 225×150 | 300×200 |
  | neither size nor viewBox | 300×150 | 300×150 (content can be cropped) |

  Aspect ratio is consistent for viewBox-only SVGs, so **use the aspect ratio of `naturalWidth/naturalHeight` and choose `W×H` yourself**: long side ≈ 3000 px (a 100 pt QR on an A4-sized sheet then gets ≥ 350 px), area capped (e.g. ≤ 16 MP). An SVG with `width="100000" height="100000"` reports a natural size of 100000² and is drawn fine at a small target; never allocate the natural size.
- **Security (measured, `<img>` + `blob:` or `data:` URL):**
  - **Scripts did not run.** A `<script>` and an `onload` handler in the SVG never fired.
  - **No external fetches.** An external `<image href>`, CSS `@import`, CSS `url()`, an `<img>` inside `foreignObject`, and a script `fetch` produced **no request** to a local beacon endpoint in either engine.
  - **Entities.** A `<!DOCTYPE>` with an internal entity rendered normally.
  - This matches MDN ("SVG as an image": JavaScript disabled, external resources not loaded).
- **Canvas tainting (Chromium only).** An SVG containing `<foreignObject>` loaded from a `blob:` URL **tainted the canvas**, so `getImageData` threw `SecurityError`. The same SVG from a `data:` URL did not taint. Firefox never tainted. WebKit was not tested. **Practical handling:** treat `SecurityError` as "this SVG cannot be scanned" or retry with a `data:` URL. Do not rely on `blob:` alone.
- **Residual risks not covered by these tests:** main-thread CPU/memory cost of pathological SVG (huge filters, deeply nested `<use>`). Rasterising cannot be aborted from a worker because it must run on the main thread. Cap the file size (and time out the UI step) if SVG becomes a supported input.

## 7. Large images: canvas limits, memory, and 12–48 MP photos

### 7.1 Canvas limits

- **Safari/iOS (WebKit source, `CanvasBase.cpp` `maxCanvasArea()`):** `8192 × 8192` (67.1 MP) on iOS family and `16384 × 16384` (268 MP) elsewhere. An older WebKit tag (`WebKit-7618.1.15.14.7`) has **`4096 × 4096` (16.7 MP) on iOS**; tag `WebKit-7623.1.14.11.9` has 8192². I did not map these tags to iOS releases. The limit is an area check; over it, the canvas has no usable backing store (`validateArea()` fails and a console warning is logged). A 48 MP photo (8000×6000) fits only on the newer limit. A **12 MP photo (4000×3000 = 12 MP) fits both**.
- **Chromium 149 (measured):** `16384×16384` works; **`16385×16385` silently returns zeros** (`getImageData` gives `0,0,0,0` and nothing throws). 20000×20000 PNG: `createImageBitmap` succeeded, the canvas was blank (`px=0`), no error.
- **Firefox 151 (measured):** 16385², 20000×10000, 30000×8000 and 12000² all worked.
- **Decompression bombs:** a solid-white PNG of 30000×30000 (2.7 MB file, 900 MP) was **rejected** by both with `InvalidStateError` in a few ms. 20000² (1.2 MB, 400 MP) was accepted by both. 12000² worked in both. There is no documented cap; observe it, do not rely on it.
- **Detection rule:** do not depend on exceptions. After `getImageData`, check dimensions, and treat an all-zero buffer from a non-trivial image as a failure.

### 7.2 Memory and time per image

Peak process RSS (sum over all browser processes, so approximate; Linux, desktop), one image decoded in a worker:

| Image | Bitmap path (`createImageBitmap` → canvas → `getImageData` → zxing) | Blob path (`readBarcodes(blob)`, stb to grey) |
|---|---|---|
| 12 MP | Chromium +209 MB, Firefox +265 MB | not measured |
| 48 MP | Chromium **+710 MB**, Firefox +730 MB | Chromium **+135 MB**, Firefox +147 MB |
| 108 MP (12000×9000) | Chromium **+1576 MB**, Firefox +1631 MB | Chromium +288 MB, Firefox +292 MB |

That is about **14.6–15 B/px** on the bitmap path (the bitmap, the canvas backing, the RGBA `ImageData`, the grey copy and the pyramid layers) and **about 2.7–2.9 B/px** on the Blob path.

Total decode time in a worker, Chromium / Firefox:

| Image | Bitmap path total | Blob path total |
|---|---|---|
| 12 MP | 350 / 400 ms | 287 / 726 ms |
| 48 MP | 760 / 1520 ms | 774 / 2593 ms |
| 108 MP | 1658 / 3326 ms | 1376 / 5694 ms |
| 200 MP (16320×12240) | 2727 / 6121 ms | 2191 / 10323 ms |

The bitmap column is `prep + wasm decode`. The two paths are close in Chromium (the Blob path is faster above 100 MP) and about 1.7× apart in Firefox, where the Blob path is slower.

**Consequences for the pipeline:**
- A pool of `cores − 1` workers each holding a 48 MP bitmap is about **5 GB on 8 cores**. Concurrency must be bounded by an **in-flight pixel budget** (about 15 B/px on the bitmap path). A starting point (to be tuned on real devices): about 100 MP in flight on desktop, about 25 MP on phones.
- The existing PDF path hands a transferred `ArrayBuffer` from the main thread to the worker. For images, decode in the worker so the main thread never holds the pixels.
- Pass the `File`/`Blob` to the worker with `postMessage`. Blob structured-clone shares the data and does not copy the bytes.

## 8. Error behaviour (input for the error taxonomy)

Measured on Chromium 149 / Firefox 151:

| Input | Chromium | Firefox |
|---|---|---|
| Empty file, or a text file named `.png` | `InvalidStateError` | `InvalidStateError` |
| Truncated JPEG / PNG | `InvalidStateError` | **decoded (partial image, no error)** |
| Unsupported format (TIFF, SVG via Blob) | `InvalidStateError` | `InvalidStateError` |
| PNG labelled `image/jpeg` | decoded (sniffed) | decoded |
| 900 MP PNG | `InvalidStateError` | `InvalidStateError` |
| > 16384² canvas | **no error, blank pixels** | decoded |

- **Always the same error name** for "cannot decode" (`InvalidStateError`) on `createImageBitmap(Blob)`; use it as the "unsupported or corrupt image" category and treat everything else as "internal".
- Truncated files are not reliably reported. Firefox returns a partial image that decodes to 0 codes, so "0 codes found" must not be reported as "this image has no codes" with certainty.
- Over-size is never reliably an exception; detect it by dimensions and by blank-output checks.

## 9. What surprises the plan or contradicts the map's Notes

1. **"`decode.js` is already source-agnostic" is true, but there is a second path.** `zxing-wasm` accepts a `Blob` and decodes it with stb_image to grey. It is slower but 5× lighter on memory and has no canvas limit. The map Notes do not mention it; it changes how "very large photos" should be handled.
2. **SVG is not a Blob decode.** The Notes list "PNG/JPG/WebP/GIF/BMP…" as if `createImageBitmap(file)` covered everything. It does not cover SVG, and **TIFF and HEIC are not covered on Chrome/Firefox at all** (HEIC works on Safari 17+ only).
3. **`getImageData` on transparent images produces an unreadable code.** The PDF flow never hits this because pdf.js paints a background. Any new image source needs the white flatten, or QR PNGs with transparent backgrounds silently decode to nothing.
4. **Chromium fails silently above 16384² px** instead of throwing, so error handling by `try/catch` is not enough.
5. **Downscaling is lossy.** The map's "Scale and memory with many large images" fog item mentions "downscaling, tiling". For QR the evidence says: do not downscale unless forced, and tile from a decoded bitmap, not from the file.
6. **zxing's docs and code disagree** about the downscale threshold (`min` in the doc comments, `max` in the code). Anyone tuning `downscaleThreshold` should use the code's semantics.
7. **`tryRotate` does nothing for QR.** The ticket mentions it; it matters only for 1D/DataMatrix/PDF417 when other symbologies become selectable.
8. **Worker pool size is not a safe concurrency limit for images** (see §7.2); the PDF flow's `BATCH_SIZE = pool.size * 2` assumes about 2 MP pages.

## 10. Open questions / suggested follow-ups

- **Real-device check on iOS Safari and Android Chrome:** worker `createImageBitmap`, the actual canvas area limit on current iOS (WebKit source says 8192², older 4096²), memory kills on 48 MP, and timings. This needs a device; it could not be done here.
- **Pixel-budget values per device class** (the numbers in §7.2 are starting points). Possibly a runtime canvas probe at start-up to find the actual limit.
- **Header sniffing for dimensions** before decoding, to reject over-size inputs without allocating them. Not needed for correctness on desktop (browsers reject 900 MP), but would prevent a hang on low-memory phones.
- **Whether to include SVG at all.** It is the only input that needs the main thread and the tainting workaround.
- **HEIC/TIFF:** this research only establishes that browsers will not decode them (apart from Safari for HEIC and TIFF). The HEIC/TIFF ticket can assume a JS/wasm decoder is needed everywhere except Safari.

## 11. Sources

- WHATWG HTML Standard, ImageBitmap and animations (`createImageBitmap`, `ImageBitmapOptions`, Blob/img/SVG steps): https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html
- MDN `Window.createImageBitmap()`: https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
- MDN, SVG as an image (restrictions): https://github.com/mdn/content/blob/main/files/en-us/web/svg/guides/svg_as_an_image/index.md
- MDN browser-compat-data v8.1.7: https://www.npmjs.com/package/@mdn/browser-compat-data (`api.createImageBitmap`, `api.OffscreenCanvas`, `api.ImageDecoder`, `api.HTMLImageElement.decode`, `mediatypes.image.*`)
- WebKit `CanvasBase.cpp` (`maxCanvasArea`, `validateArea`, noise injection): https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp
- WebKit older tag with iOS 4096²: https://github.com/WebKit/WebKit/blob/WebKit-7618.1.15.14.7/Source/WebCore/html/HTMLCanvasElement.cpp
- WebKit `ImageBitmapOptions.h/.idl`, `ImageBitmap.cpp`, `WindowOrWorkerGlobalScope.idl`: https://github.com/WebKit/WebKit/tree/main/Source/WebCore/html and https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/WindowOrWorkerGlobalScope.idl
- WebKit `CanvasNoiseInjection.cpp`: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasNoiseInjection.cpp
- zxing-cpp `ReadBarcode.cpp`, `ReaderOptions.h`, `QRDetector.cpp`, `QRReader.cpp`, `ODReader.cpp`, `DMReader.cpp` at the pinned commit: https://github.com/zxing-cpp/zxing-cpp/tree/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src
- zxing-wasm: https://github.com/Sec-ant/zxing-wasm (README, `src/cpp/ZXingWasm.cpp`: `readBarcodesFromImage` uses stb_image)
- stb_image.h (supported formats, EXIF not handled): https://github.com/nothings/stb/blob/master/stb_image.h
