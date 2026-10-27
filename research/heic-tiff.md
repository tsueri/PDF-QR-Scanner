# HEIC/HEIF and multi-page TIFF decoding without a bundler

Ticket: [#21](https://github.com/tsueri/PDF-QR-Scanner/issues/21), child of the map [#18](https://github.com/tsueri/PDF-QR-Scanner/issues/18).
Researched 2026-10-27. Everything below marked **(measured)** was run by me in a throwaway directory outside the repo
(Node 22, headless Chrome 150 via the repo's own puppeteer, zxing-wasm from the repo's `node_modules`).
Everything else is cited to its primary source.

## TL;DR

| | Recommendation |
|---|---|
| **Multi-page TIFF** | **Ship it**, with `utif2` 4.1.0 (MIT, ~118 KB raw / ~38 KB gzip, pure JS, no wasm). Each IFD is one "page", which maps 1:1 onto the existing `page,qr-code` model. Needs a small build-time wrapper to become an ES module; no bundler. Known gaps (below) must be written down as "unsupported" errors. |
| **HEIC/HEIF** | **Ship in two tiers, both lazy, neither in milestone 1.** (1) Free tier: try the browser's own decoder (`createImageBitmap`); this works on Safari 17+ only. (2) Fallback tier: `libheif-js` 1.23.x wasm, loaded only when a HEIC file is dropped and tier 1 failed. This tier carries **LGPL-3.0** obligations and an **HEVC patent** question that the owner has to accept explicitly (see "Decision the owner must make"). If the owner will not accept them, ship tier 1 only and show a clear "convert to JPEG first" error elsewhere. |
| **Bundler** | **Not forced by either format.** Both libraries run as plain static ES modules in a module Worker in Chrome 150 (measured), using the same kind of build-time string patch `scripts/build-release.mjs` already applies to zxing's `share.js`. The map's "relaxable if HEIC/TIFF forces it" clause does not need to be invoked. |
| **Do not use** | `heic2any` (stale since 2023, ships an old asm.js libheif, needs `unsafe-eval`, main-thread DOM, re-encodes to PNG/JPEG, ~4x slower). `utif` 3.1.0 (stale since 2022, mis-decodes tiled/palette/RGBA TIFFs). `tiff.js` (last push 2020-04, Emscripten port of libtiff, not tested here because it is stale). `image-js/tiff` (good code, but no CCITT/JPEG/PackBits, which is exactly what scanned multi-page TIFFs use). |

## Findings that change the plan or contradict the map's Notes

1. **The no-bundler preference does not have to be relaxed.** Map Notes say it is "relaxable if HEIC/TIFF forces it". It does not. Details under "Fit with `scripts/build-release.mjs`".
2. **Chrome, Edge and Firefox cannot decode HEIC at all; Safari 17+ can.** caniuse `heif`: Chrome/Edge/Firefox "n" through the newest listed versions, Safari 17.0+ and iOS Safari 17.0+ "y". I also confirmed `createImageBitmap(blob)` on a HEIC file fails with `InvalidStateError` in Chrome 150 **(measured)**. So any non-Safari user needs a wasm decoder. Only ~17% of global usage is covered natively (caniuse `usage_perc_y` 16.93).
3. **TIFF is the same shape**: MDN lists TIFF as "Safari" only, and `createImageBitmap` on a TIFF fails in Chrome 150 **(measured)**.
4. **HEIC is a licensing/legal decision, not only a size decision.** The only maintained wasm HEIC decoder is libheif + libde265, both **LGPL-3.0**, decoding **HEVC**, which is covered by the HEVC Advance patent pool. The app is MIT and the release zip currently ships only the app's own `LICENSE` (no third-party notices for pdf.js/zxing/jszip either, which is already a small gap).
5. **The "multi-page TIFF" that people actually have is a scanned fax-style document (CCITT G4 / Group 3, LZW, PackBits, JPEG).** MDN says exactly this. The best-maintained pure-ESM TIFF decoder (`image-js/tiff`) rejects all of those except LZW/Deflate. Only the UTIF family handles them **(measured)**.
6. **`utif2` is the right pick but has two reproducible defects in my test matrix**: grayscale JPEG-in-TIFF decodes to wrong pixel values (mean pixel 189 vs correct 178, QR not found), and CMYK TIFFs throw `window is not defined` inside a Worker. Both must be surfaced as "unsupported TIFF variant" errors, or fall back to `utif` 3.1.0 for JPEG (which decodes grayscale JPEG correctly but fails tiled/palette/RGBA).
7. **libheif security cadence matters.** libheif's own README (October 2026) says it is maintained by a single developer and that "89 security advisories had to be investigated, fixed and released in 2026 alone". `libheif-js` 1.23.5 trails libheif upstream 1.23.7. The wasm sandbox contains memory-safety bugs to the worker, but a vendored copy needs an update routine.
8. **Memory is large for big photos.** 48 MP HEIC: ~5.2 s decode in Node, ~6.5 s in a Chrome worker, peak process RSS ~910 MB **(measured)**. 12 MP: ~1.3-1.5 s, peak ~350 MB. This feeds the "scale and memory" fog item: use **one dedicated decode worker**, not the whole scan pool (each pool worker would otherwise grow its own wasm heap).

## Comparison table

Sizes measured from the npm tarballs. "gz" is `gzip -9`. Existing vendored assets for scale: zxing wasm 967 KB (417 KB gz), pdf.worker 1.38 MB, pdf.mjs 353 KB.

### HEIC

| | `libheif-js` 1.23.5 | `heic-decode` 2.1.0 | `heic2any` 0.0.4 | Native (Safari 17+) |
|---|---|---|---|---|
| What it is | Emscripten build of libheif (libde265 decoder, AOM/AVIF disabled). Low-level `HeifDecoder`. [repo](https://github.com/catdad-experiments/libheif-js) | 6 KB wrapper over `libheif-js/wasm-bundle`; returns `{width,height,data}`. [repo](https://github.com/catdad-experiments/heic-decode) | Prebuilt browser bundle: embedded **old asm.js** libheif, converts to PNG/JPEG/GIF Blob. [repo](https://github.com/alexcorvi/heic2any) | `<img>` / `createImageBitmap` on the Blob. Safari 17.0 added HEIC ([WebKit blog](https://webkit.org/blog/14445/webkit-features-in-safari-17-0)). |
| Licence | **LGPL-3.0** (libheif, libde265 both LGPL; their sample apps MIT) | ISC wrapper, but pulls in `libheif-js` => LGPL-3.0 in the shipped binary | Declares MIT, but the bundle embeds libheif/libde265 (LGPL); MIT label does not remove that | n/a |
| Patent note | Decodes HEVC; see below | same | same | Apple's licence, not ours |
| Size | wasm **1,463,506 B (483 KB gz)** + loader JS 91 KB (29 KB gz). Pre-bundled `libheif-bundle.mjs` (wasm as base64): 2,043,959 B (**717 KB gz**). Default `require('libheif-js')` entry is the pure-JS asm.js build, 3.19 MB. | 6 KB + libheif-js bundle | `heic2any.min.js` 1.35 MB, single file | 0 |
| Static ESM, no bundler | **Yes**: `libheif-bundle.mjs` is a ready ES module with `export default` factory (measured, module worker). `libheif-wasm/libheif.js` is a classic script (`var libheif=...; module.exports=...`); with a one-line append `export default libheif;` it also works as ESM and loads `libheif.wasm` via `locateFile` (measured). | npm entry is CJS (`require`), would need rewriting; not useful because `lib.js` is 60 lines we can write ourselves | No: UMD global, main thread only | n/a |
| Worker / OffscreenCanvas | **Works in a module Worker** (Chrome 150). Output is RGBA via `display(ImageData-like)`, no canvas needed, so no OffscreenCanvas dependency. | same | **No**: creates a blob Worker itself and needs `window`, `document`, canvas (it re-encodes). `new Function` inside => needs `unsafe-eval` | `createImageBitmap` works in Workers in general; Safari HEIC-in-Worker not verified by me |
| Multi-image files | `decode()` returns an array of top-level images | `.all()` supported | first image unless `multiple: true` (then returns array of Blobs) | primary image only |
| Speed / memory (measured) | 12 MP: 1.3-1.5 s; 48 MP: 5.2 s Node / 6.5 s Chrome worker; peak RSS 350 MB / 910 MB | same engine | 12 MP: **4.97 s** and a 30 MB PNG Blob that must be decoded again | hardware/OS decoder, fastest |
| Maintenance | Active: pushed 2026-10-04; version tracks libheif major.minor | Last push 2025-07 | **Stale: last release/commit 2023-03/04, 25 open issues** | Browser vendor |
| Verdict | **Use** (as fallback tier) | Skip, write the 60-line wrapper ourselves | **Do not use** | **Use first** (feature-detect by trying) |

### TIFF

| | `utif2` 4.1.0 | `utif` 3.1.0 | `tiff` (image-js) 7.1.3 | `tiff.js` (seikichi) | Native |
|---|---|---|---|---|---|
| Licence | MIT (+ `pako` MIT AND Zlib) | MIT (+ pako) | MIT (+ fflate MIT, iobuffer MIT) | Not verified (GitHub reports no SPDX licence); port of libtiff compiled with Emscripten ([README](https://github.com/seikichi/tiff.js)) | n/a |
| Size | `UTIF.js` 95.7 KB (30.8 KB gz) + `pako_inflate.min.js` 22.7 KB (7.8 KB gz) = **~118 KB / ~38 KB gz** | UTIF.js 58 KB + pako | ~40 KB JS + fflate (91 KB unminified ESM) + iobuffer | Emscripten port of libtiff; not benchmarked (stale) | 0 |
| Static ESM, no bundler | **Classic script** (`self.UTIF`, reads `self.pako`). Works as ESM if the build concatenates `pako_inflate.min.js` + `UTIF.js` + `export default self.UTIF;` (measured in a module Worker). | same pattern | Pure ESM but has **bare imports** (`'iobuffer'`, `'fflate'`); needs import-map (not available in Workers) or a build-time path rewrite | no | n/a |
| Worker compatible | Yes (measured). Exception: CMYK TIFFs touch `window` and throw in a Worker | Yes | Yes | n/a | n/a |
| Multi-page | Yes: `decode()` returns all IFDs; pixel decode is lazy per IFD (`decodeImage(buf, ifd)`), so pages can be decoded and released one by one | Yes, same API | Yes (`decode(data, {pages})`) | Yes | Safari shows only the first |
| Compression coverage (measured, ImageMagick-generated files, QR content verified with zxing) | none, LZW(+predictor), Deflate, **CCITT G3/G4**, PackBits, tiled, 1/4/8/16-bit, palette, RGBA, planar, big/little endian, **RGB JPEG** all OK. **Fail**: grayscale JPEG (wrong pixels), CMYK (throws in Worker) | OK on G3/G4/PackBits/Deflate/LZW/JPEG; **fail** on tiled, 4-bit palette, RGBA (QR not found) | OK: none, LZW, Deflate, planar, 16-bit. **Fail** (throws): CCITT G3/G4, JPEG, PackBits, 4-bit palette, CMYK | n/a | Safari only |
| Speed (measured) | 12 MP LZW: 0.3-0.7 s; 48 MP: 1.3 s Node / 3.4 s Chrome worker | 12 MP: 0.57 s | 12 MP: **4.2 s**; 48 MP: **21 s** | n/a | n/a |
| Maintenance | npm last published 2023-05 by a third party (`jbereza`) as a fork of Photopea's UTIF; upstream [photopea/UTIF.js](https://github.com/photopea/UTIF.js) pushed 2026-05-04 (MIT). Photopea [does not publish to npm](https://github.com/photopea/UTIF.js/issues/106). | Last published 2022-06 | Active: pushed 2026-08, releases 2025-12 | Last push 2020-04 | Browser |
| Verdict | **Use** | Skip (superseded; only better at JPEG) | Skip (fails the real-world fax/scan case) | Skip | Not enough (Safari only, first page only) |

TIFF sanity facts from MDN: "A single TIFF file can contain multiple images ... multi-page scanned document, or a received fax. However, software reading TIFF files is only required to support the first image", and "the most commonly used [compressions] are the CCITT Group 4 (and, for older fax systems, Group 3) ... as well as LZW and lossy JPEG" ([MDN image types guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types)).

## Licensing detail (HEIC)

* `libheif`: "distributed under the terms of the GNU Lesser General Public License. The sample applications are distributed under the terms of the MIT License." ([libheif README](https://github.com/strukturag/libheif#license), [COPYING](https://github.com/strukturag/libheif/blob/master/COPYING)). Same wording for `libde265` ([README](https://github.com/strukturag/libde265#license)). The wasm build uses libde265 only (`ENABLE_LIBDE265=1`, `ENABLE_AOM=0` defaults in [`build-emscripten.sh`](https://github.com/strukturag/libheif/blob/master/build-emscripten.sh); the exact libde265 pin lives in libheif's submodule at the version `libheif-js` built). `libheif-js`'s own `package.json` says `LGPL-3.0` and ships `LICENSE` inside `libheif/` and `libheif-wasm/`.
* An MIT app can ship LGPL-3.0 components. My reading of [LGPL-3.0 section 4](https://www.gnu.org/licenses/lgpl-3.0.html#section4) (not legal advice) for this case: give prominent notice, ship the LGPL and GPL texts, and let a user replace the library with a modified version. A **separate `libheif.wasm` file served next to a small loader** is the natural way to satisfy that (a user can swap the file). The base64-inlined `libheif-bundle.mjs` is a weaker fit. Corresponding source is public ([libheif-emscripten](https://github.com/catdad-experiments/libheif-emscripten) builds libheif "without modification to source or build scripts"). The anti-lock-down clause applies to consumer "User Products" and does not bite a web page.
* Practical consequence: add a `THIRD-PARTY-NOTICES` file to the release zip (this also fixes the existing pdf.js/zxing/jszip attribution gap), include the libheif LICENSE, name the exact libheif/libde265 versions and link the source. The release zip must keep `libheif.wasm` as a standalone file.
* **Patents.** HEVC is covered by the HEVC Advance pool (Access Advance), which says its programs are "focused on licensing hardware and consumer software" and that it "reserves the right to seek licenses from any party infringing HEVC Standard Essential Patents" ([HEVC Advance overview](https://accessadvance.com/licensing-programs/hevc-advance), [program overview PDF](https://cdn.arstechnica.net/wp-content/uploads/2025/11/HEVC-Advance-Program-Overview-July-2025.pdf)). caniuse gives this as the reason browsers other than Safari do not decode HEIC ("complex and expensive to license"). Neither libheif nor libde265 documents a patent grant in their READMEs. I cannot resolve this from primary sources; it is a risk acceptance for the owner, not a technical question. Mitigations if desired: run decode only on user-dropped files client-side (no distribution of HEVC content), keep it lazy/opt-in, and keep the native tier first.
* Separate observation: libheif's AVIF support (AV1) would be patent-lighter and browsers decode AVIF natively (MDN: Chrome 85, Edge 121, Firefox 93, Safari 16.1), so no wasm is needed for AVIF. The `libheif-js` build here has AOM disabled; do not expect it to decode AVIF, and do not need it to.

## Fit with `scripts/build-release.mjs`

Current pattern: copy files from `node_modules` into `release/vendor/`, text-patch import specifiers (`../share.js` becomes `../share.js?v=<version>`), copy source files through `withVersion()` (`__ASSET_VERSION__`), then a sanity check that no token is left, then zip. Workers are module workers (`new Worker(url, {type:'module'})` in `scan.js`), and `decode.js` resolves its wasm with `locateFile` + `?v=`.

**TIFF (`utif2`)**: add `utif2` and `pako` as dependencies. In the build script, write `release/vendor/utif2/utif2.mjs` as `pako_inflate.min.js + "\n;" + UTIF.js + "\nexport default self.UTIF;\n"` (verified working; `pako` is MIT AND Zlib, add its notice). Source tree (dev, unbuilt) needs a matching committed shim or the same concatenation at `npm install` time; simplest is a tiny `src/vendor-shims/utif2.mjs` that re-exports a file generated by the same function used in the build, so dev and release load the same URL shape. Add the file to the `versionedFiles` sanity list if it contains the version token.

**HEIC (`libheif-js`)**: two vendoring options.
* *A (preferred)*: copy `libheif-wasm/libheif.js` to `vendor/libheif/libheif.mjs` with the trailing UMD export line replaced by `export default libheif;`, copy `libheif-wasm/libheif.wasm` and `libheif-wasm/LICENSE`, and call the factory with `locateFile: p => new URL(p, import.meta.url)` plus `?v=`. Same technique as the zxing patch. Smaller transfer (483 KB gz vs 717 KB gz) and the wasm is a standalone, replaceable file (LGPL-friendly).
* *B (zero patching)*: vendor `libheif-bundle.mjs` as-is. Simplest, but 717 KB gz and wasm is inlined.
* Both load only via dynamic `import()` on first HEIC file, so the base page weight does not change.

**Where decoding runs**: both decoders produce RGBA and run fine inside a module Worker (measured). Put them in **one dedicated "decode" worker** that returns `ImageData` pages to the existing scan pool through the same `postMessage(..., [imageDataBuffer])` path `scan.worker.js` already uses. `decode.js` (`decodeImageData`) and `scanPDF`'s pool need no change, since decoded pages are just `ImageData`. Multi-page TIFF: decode IFD *n*, post it, drop it, move on (the library does not force holding all pages).

**Tests**: PDF tests (`npm test`, `npm run test:integration`) are unaffected because none of this touches the PDF path. New fixtures can be generated deterministically (I used `pillow-heif` and ImageMagick; see "Reproducing").

## What I did not verify

* Safari: no Safari available. HEIC-in-`createImageBitmap`, in-Worker, and behaviour on iPhone grid/HDR/gain-map HEICs are untested. Anecdotally (Hacker News/StackOverflow threads, **not** primary sources) iOS/macOS Safari's file picker converts Photos HEICs to JPEG on selection, which would make tier 2 irrelevant for iPhone-to-Safari users; check on a device before relying on it.
* Real iPhone HEIC files (multi-image, depth, tiled grids). My HEICs are single-image files from `pillow-heif`/x265. libheif supports grids/multiple images per its README.
* Firefox decode timings (only Chrome 150 headless and Node).
* Whether wasm memory is returned after a large decode. Emscripten heaps generally only grow, which is why I recommend a single decode worker you can terminate/recreate after a very large file. That recommendation is standard Emscripten behaviour, not something I measured.
* Legal conclusions are my reading, not legal advice.

## Reproducing

Throwaway directory: `/tmp/opencode/heic-exp` (not in repo). Packages: `libheif-js@1.23.5`, `heic-decode@2.1.0`, `heic2any@0.0.4`, `utif@3.1.0`, `utif2@4.1.0`, `tiff@7.1.3`. Test files: `pillow-heif` + `qrcode` for HEIC, `Pillow`/ImageMagick for TIFF variants (JPEG, YCbCr JPEG, CMYK, 16-bit, tiled, gray, palette, Zip, LZW+predictor, planar, RGBA, Group 3, Group 4, PackBits, multi-page). Each decoded image was fed to `zxing-wasm` `readBarcodes` with `formats: ['QRCode'], tryHarder: true` as in `src/decode.js`; "OK" means the QR payload was read back.

## Sources

* libheif README (formats, codecs, licence, project status, security advisories): <https://github.com/strukturag/libheif>
* libheif `build-emscripten.sh` (codec flags): <https://github.com/strukturag/libheif/blob/master/build-emscripten.sh>
* libde265 README (licence): <https://github.com/strukturag/libde265>
* libheif-js (README, `package.json`, install script, usage variants): <https://github.com/catdad-experiments/libheif-js>
* libheif-emscripten (build provenance): <https://github.com/catdad-experiments/libheif-emscripten>
* heic-decode: <https://github.com/catdad-experiments/heic-decode>
* heic2any: <https://github.com/alexcorvi/heic2any>
* UTIF.js (Photopea): <https://github.com/photopea/UTIF.js>, utif2 on npm: <https://www.npmjs.com/package/utif2>
* image-js/tiff: <https://github.com/image-js/tiff>
* tiff.js: <https://github.com/seikichi/tiff.js>
* caniuse `heif`, `hevc` data: <https://github.com/Fyrd/caniuse/blob/main/features-json/heif.json>, <https://github.com/Fyrd/caniuse/blob/main/features-json/hevc.json>
* WebKit, Safari 17.0 (HEIC support): <https://webkit.org/blog/14445/webkit-features-in-safari-17-0>
* MDN image file type guide (TIFF Safari-only, multi-page, compression, AVIF support): <https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types>
* HEVC Advance (Access Advance): <https://accessadvance.com/licensing-programs/hevc-advance>
* GNU LGPL-3.0: <https://www.gnu.org/licenses/lgpl-3.0.html>
