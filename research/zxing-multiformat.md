# zxing-wasm multi-format reading: formats, cost, and options

Research for #23 (child of the map #18). Planning input only; no app code was changed.

- Repo state examined: `origin/main` @ `578cf02` (app v1.4.0, `zxing-wasm` locked at **3.1.5**, reader build).
- Also tested: `zxing-wasm` **3.1.6** (npm `latest`, published 2026-10-19) installed in a scratch dir outside the repo.
- zxing-wasm 3.1.5 bundles zxing-cpp commit `2ecec3f5be0e` (`ZXING_CPP_COMMIT` in the package); the latest zxing-cpp tag is v3.1.1.
- Experiment host: Intel Core Ultra 7 155H, Node 22 (V8 wasm, single thread). Browser timings will differ in absolute terms. Treat the **ratios** as the finding, not the milliseconds.

## 1. Recommendation (TL;DR)

1. **Keep the `reader` build and move the pin to `^3.1.6`.** The reader wasm already reads every format zxing-cpp can read. The `full` build only adds the writer, about +0.55 MiB, which we don't need. 3.1.6 is 20–45% faster than 3.1.5 in my runs, has a smaller wasm, and fixes WASM memory leaks and an out-of-bounds read with `tryDenoise`+`tryDownscale`. The repo's unit tests (28) and Puppeteer integration tests (20) pass unchanged on 3.1.6, and also with `formats: []`.
2. **Formats are a per-scan setting, not a build choice.** Narrowing `formats` saves CPU only. The wasm download is identical, and there is no size benefit from narrowing.
   - Default `['QRCode']` is unchanged. Note that it already includes Micro QR, rMQR and QR Model 1/2 (see §3).
   - Presets map directly onto zxing's meta-formats: `AllMatrix` (2D), `AllLinear` (1D), `AllReadable` (everything).
   - `[]`, `['All']` and `['AllReadable']` returned identical results on all 32 format samples that I could write (3 of the 35 failed to encode because of my sample input).
   - For per-symbology checkboxes, use the 14 symbology roots (`BARCODE_SYMBOLOGIES`), not the 41 readable variants.
3. **Enabling everything costs about 2–5× QR-only CPU per image** (§4). It produced zero valid false positives on 303 non-barcode images, as long as `returnErrors` stays `false`. It makes the customer-card DataMatrix marks show up, which is exactly why format selection must be opt-in.
4. **Keep zxing's `try*` defaults (all `true`) and `tryHarder: true`.** Turning `tryHarder` off drops DataMatrix and 1D codes the app would otherwise find. Turning `tryDownscale` off loses the tilted-QR fixture. Only `maxNumberOfSymbols: 1` is worth switching on, and only for a camera one-shot mode.
5. **Expose per code:** `format`, `symbology`, `text`, `contentType`, `position` and, for non-text payloads, `bytes`. Keep `symbologyIdentifier`, the parsed `extra` (EC level, version) and `rotation` as JSON-only extras. Never expose `symbol`, `bytesECI`, or the deprecated fields (§5).
6. **Pitfalls that change the plan:** see §8. The main ones are the dedupe key, per-worker options, filtering `isValid`, and UPC-A reported as EAN-13.

## 2. Readable formats and how to select them

Source: zxing-wasm README "Supported Barcode Formats" and `dist/es/bindings/barcodeFormat.d.ts`; zxing-cpp README "Supported Formats".

Everything below is readable by the `reader` build. EAN-5 and EAN-2 are write-only: they exist as add-on symbols only (README footnote).

| Group | Symbology root (usable as a `formats` entry) | Variants returned in `format` |
|---|---|---|
| 2D | `QRCode` | `QRCode`, `QRCodeModel1`, `QRCodeModel2`, `MicroQRCode`, `RMQRCode` |
| 2D | `DataMatrix` | `DataMatrix` |
| 2D | `Aztec` | `Aztec`, `AztecCode`, `AztecRune` |
| 2D | `PDF417` | `PDF417`, `CompactPDF417`, `MicroPDF417` |
| 2D | `MaxiCode` | `MaxiCode` (only pure, unrotated, unskewed, well-bordered images; README footnote) |
| 1D retail | `EANUPC` | `EAN13`, `EAN8`, `UPCA`, `UPCE`, `ISBN` (+ add-ons) |
| 1D retail | `DataBar` | `DataBar`, `DataBarOmni`, `DataBarStk`, `DataBarStkOmni`, `DataBarLtd`, `DataBarExp`, `DataBarExpStk` |
| 1D industrial | `Code128` | `Code128` |
| 1D industrial | `Code39` | `Code39`, `Code39Std`, `Code39Ext`, `Code32`, `PZN` |
| 1D industrial | `Code93` | `Code93` |
| 1D industrial | `ITF` | `ITF`, `ITF14` |
| 1D industrial | `Telepen` | `Telepen`, `TelepenAlpha`, `TelepenNumeric` |
| 1D other | `Codabar` | `Codabar` |
| 1D other | `OtherBarcode` | `DXFilmEdge` |

Not in zxing-cpp's list, so not readable: Code 11, MSI/Plessey, Pharmacode, the postal 4-state codes (POSTNET, Royal Mail, …), Han Xin, Codablock, DotCode. This is "absent from the supported list", not something I tested.

### Expressing presets

`ReaderOptions.formats` accepts (README "Format Names Accepted as Input", `readerOptions.d.ts`):

- Canonical names (`QRCode`, `EAN13`).
- HRI labels, case- and separator-insensitive (`"Data Matrix"`).
- Meta-formats: `All`, `AllReadable`, `AllLinear`, `AllMatrix`, `AllGS1`, `AllRetail`, `AllIndustrial`, `AllCreatable`.
- Deprecated aliases: `Any`, `Linear-Codes`, `Matrix-Codes`.

Verified with 3.1.5:

- `[]`, `['All']` and `['AllReadable']` gave identical results on every format sample (32 written, then read back).
- `AllMatrix` read DataMatrix, and `AllLinear` read Code128.
- `AllRetail` did not read Code128, and `AllIndustrial` did.
- A symbology root matches its variants: `['QRCode']` read Micro QR and rMQR; `['PDF417']` read MicroPDF417; `['Code39']` read PZN and Code39Ext; `['EANUPC']` read UPC-A.
- **`AllGS1` did not read a plain QR code** (QR is flagged GS1-capable in the table) but did read GS1 DataMatrix/Code128. I don't understand why. Don't ship `AllGS1` as a preset without a closer look.
- **`['ISBN']` alone read nothing** from an ISBN EAN-13 sample, while `['EANUPC']` and `['EAN13']` did. Don't offer ISBN as a separate selector. It is just EAN-13 with a 978/979 prefix.
- Unknown format names don't throw. `readBarcodes` returns a single pseudo-result with `isValid:false` and `error: "This is not a valid barcode format: …"`. Validate names against `BARCODE_FORMATS` / `BARCODE_META_FORMATS` in our own code.

The helper constants and functions (`BARCODE_FORMATS`, `BARCODE_SYMBOLOGIES`, `READABLE_BARCODE_FORMATS`, `LINEAR_BARCODE_FORMATS`, `MATRIX_BARCODE_FORMATS`, `BARCODE_HRI_LABELS`, `formatToLabel`, `symbologyToFormats`, `formatToSymbology`) are exported by `zxing-wasm/reader`. They can drive the selection UI and labels with no hand-maintained list. The release build already vendors that file.

### Format quirks seen when reading with broad selectors (3.1.5)

- **UPC-A is reported as `EAN13`** with a leading `0`, so the text is 13 digits. Only a narrowed `['UPCA']` reports `format: 'UPCA'`, and even then `text` is still the 13-digit form. UPC-E is expanded to 13 digits the same way (`0012345000065` in my run); zxing-cpp documents the original value under `extra.UPCE`.
- `ITF14` reads back as `ITF` (text unchanged) under every selector I tried.
- A **Telepen Numeric** sample was misread as `TelepenAlpha` with garbage text (`'=Siu`) under `[]`, `Telepen` and `TelepenAlpha`. Only `['TelepenNumeric']` read it right. Rare symbology, but it is a real ambiguity under "all".
- `AztecRune`, `CompactPDF417` and `QRCodeModel2` come back as `Aztec`, `PDF417` and `QRCode`. Don't rely on the variant being present.

## 3. Result fields

Source: `ReadResult` / `ZXingReadResult` typings in the package, `src/cpp/ZXingWasm.cpp` in the zxing-wasm repo, and zxing-cpp `Barcode.h`. All values below were observed in the experiments.

| Field | Meaning | Recommendation |
|---|---|---|
| `isValid`, `error` | `false` for failed reads and for pseudo-results (§8) | **Always filter `isValid`.** |
| `format` | canonical variant name (`QRCode`, `EAN13`, …) | Expose (CSV + JSON). |
| `symbology` | root family (`EAN13` → `EANUPC`) | Expose in JSON. Useful for grouping and filtering. |
| `text` | payload rendered per `textMode` (§6) | Expose. |
| `bytes` | raw payload bytes (`Uint8Array`), not affected by `textMode` | Expose in JSON (hex/base64) when `contentType !== 'Text'`; always available. |
| `contentType` | `Text`, `Binary`, `Mixed`, `GS1`, `ISO15434`, `UnknownECI` | Expose. Drives the results view (GS1 / binary badges). |
| `position` | four corners `{topLeft, topRight, bottomRight, bottomLeft}` in pixels | Keep, as `decode.js` does today. It drives reading order and is the future hook for overlays. |
| `rotation` (alias `orientation`) | degrees. `orientation` is deprecated since 3.1.4. | JSON-only extra. |
| `isMirrored`, `isInverted` | symbol flags | JSON-only extras, optional. |
| `symbologyIdentifier` | AIM `]cm`, e.g. `]Q1`, `]d2` (GS1 DataMatrix), `]C1` (GS1-128) | JSON-only extra. It is the reliable "is GS1" signal. |
| `extra` | JSON **string**: `ECLevel`, `Version`, `DataMask`, `UEC`, `EanAddOn`, `UPCE`, PDF417 macro keys | Parse it. Expose `ecLevel`/`version` in JSON only. |
| `ecLevel`, `version`, `readerInit` | deprecated mirrors of `extra` | Don't use. |
| `sequenceSize`/`Index`/`Id` | structured append (a message split across several symbols) | Fog: capture the fields in JSON, don't try to reassemble yet. |
| `lineCount` | 1D only: number of agreeing scan lines | Skip. |
| `hasECI`, `bytesECI` | ECI info | Skip. |
| `symbol` | `Uint8ClampedArray` image of the symbol, marked `@experimental` | **Never expose.** It is a per-code image copy. Dropping it before `postMessage` keeps worker traffic small. |

`decode.js` already maps to a small record (`data`, `position`); it can grow `{format, symbology, contentType, bytes?}` without touching `position`.

### Today's `'QRCode'` default is wider than "QR Model 2"

`['QRCode']` is a symbology root, so the current default **already reads Micro QR, rMQR and QR Model 1**. The map's "default QR only" holds in spirit, but the preset label needs to say "QR family". If we ever want Model 2 only, use `QRCodeModel2` (still returned as `format: 'QRCode'`).

## 4. Reader options and cost

Defaults come from `ReaderOptions.h` at the pinned zxing-cpp commit and `readerOptions.d.ts`: `tryHarder`, `tryRotate`, `tryInvert` and `tryDownscale` are all **true** by default. `tryDenoise`, `isPure` and `returnErrors` default to false. `binarizer` defaults to `LocalAverage`, `maxNumberOfSymbols` to 255, `downscaleThreshold` to 500 (min image side) and `downscaleFactor` to 3. `minLineCount` defaults to 2, and `textMode` to `HRI`.

### Format cost (`readBarcodes`, `tryHarder: true`, medians of 15–21 runs, ms)

| Image | `['QRCode']` (today) | `AllMatrix` | `AllLinear` | `[]` (all) | all ÷ QR |
|---|---|---|---|---|---|
| `fixtures/example.pdf`, rendered at the app's 2× scale (1191×1684) | 20 | 32 | 13 | 42 | 2.1× |
| synthetic customer card: QR + 4 DataMatrix marks (1191×1684) | 11 | 37 | 16 | 49 | 4.5× |
| same card + a Code128 strip | 11 | 38 | 26 | 55 | 5.0× |
| real 10 MP JPEG, no code (3840×2594, "fern") | 55 | 284 | 61 | 320 | 5.8× |
| real JPEG, no code, scaled to 1200 px wide | 5 | 25 | 18 | 40 | 8× |

Observations:

- Most of the extra cost is the **2D** detectors. `AllLinear` adds little, and `AllMatrix` is most of `all`.
- Throughput with everything enabled is about 25–35 ms per megapixel in Node (3.1.5). The cost shows up on pages and photos that contain nothing.
- **3.1.6 is faster across the board.** The same runs: fixture 16/18/10/23, card 8/21/13/30, 10 MP photo (fern) 49/204/52/256. That is roughly 20–45% faster. The 63-image no-code set took 4.3 s with all formats on 3.1.6 vs 6.4 s on 3.1.5, and 0.98 s vs 1.24 s with QR only.
- Each wasm instance reserves about 21 MiB of heap regardless of which formats are enabled. The worker pool (`cores - 1` workers) multiplies that. This is a constant for the pipeline-architecture ticket, not something format choice changes.
- Instantiation was about 13 ms in Node, independent of formats.

### Option cost and effect (all formats, 3.1.5; ratio to defaults)

| Option change | fixture PDF | card + C128 | 10 MP photo | Effect on what is found |
|---|---|---|---|---|
| `tryHarder:false` | 0.40× | 0.33× | 0.34× | **Loses the 4 DataMatrix marks** (found 2 of 6). Misses 4 of 5 codes on the 15°-tilted card. |
| `tryRotate:false` | 0.61× | 1.09× (noise) | 0.51× | Misses 90°-rotated Code128, DataMatrix and QR (only the QR was found on the 90° card). 180° still works. |
| `tryInvert:false` | 0.76× | 0.77× | 0.70× | Finds nothing on a white-on-black card. |
| `tryDownscale:false` | 0.80× | 0.81× | 0.83× | **Fixture QR no longer found** (0 results). |
| `tryDenoise:true` | 2.4× | 1.4× | 1.4× | No additional codes in any of my samples. Leave off. |
| `minLineCount:1` | 1.0× | 1.8× | 1.0× | Looser 1D acceptance. More cost, higher false-positive risk. Leave at 2. |
| `maxNumberOfSymbols:1` | n/a | n/a | n/a | Returns just one code (the QR). The card runs took about 9 ms instead of 50–90 ms. Right for a camera one-shot, wrong for batch. |
| `isPure:true` | n/a | n/a | n/a | Returned nothing on page-sized images. Only for clean generated images. |
| `binarizer` `GlobalHistogram` / `FixedThreshold` | ≈1× | ≈1× | ≈1× | Same results on my samples. Keep `LocalAverage`. |

Recommendation: **batch scanning keeps the defaults (`tryHarder: true`, everything else default) and sets nothing else.** If the results view later wants a "faster, less thorough" switch, `tryInvert: false` (about −25%) is the safest knob. It only loses inverted codes. `tryRotate: false` is the biggest saving (about −40–50%) but loses sideways pages and photos.

### False-positive probe

- **Corpus (303 images):**
  - 16 real photographs, each at full size (3840 px), 1200 px and 640 px wide (the Nextcloud theming backgrounds on this machine, including ribbed metal, bricks and fern textures).
  - Synthetic noise, stripes, grid and text pages: white and gray noise, random-width vertical stripes, a 20 px grid, and a dense text page.
  - 240 adversarial images: random rectangles, horizontal, vertical and diagonal random stripes, and random checker and 2D-block patterns.
- **Result with `formats: []` and `returnErrors: false`: 0 results on all 303 images.**
- With `returnErrors: true` there were 7 "hits" on the 63-image set. All were `DataMatrix` with `isValid:false`, a checksum error and empty text. **Keep `returnErrors` off.**
- Caveat: this shows no valid false positives on this corpus. It does not prove the rate is zero. `minLineCount: 2` is the guard for 1D, and it is the default.

## 5. Customer-card behaviour (the map's DataMatrix concern)

The repo has no customer-card fixture, so I built a synthetic one: an A4 raster at the app's 2× scale (1191×1684) with a QR code, four DataMatrix marks (two distinct payloads, each repeated in two corners), text lines and an optional Code128 strip.

- With `['QRCode']` it returns the QR only (matches today).
- With `AllMatrix` or `[]` it additionally returns **four DataMatrix results**. Two payloads are each repeated, so the page has 4 DataMatrix reads but only 2 distinct payloads.
- These are **real, valid reads, not false positives**. The "ignore DataMatrix" behaviour must therefore remain the default, and the per-scan format selection is what controls it.
- `orderAndDedupeCodes` dedupes on `data` alone. With multiple formats this has to become `(format, data)`. Otherwise a QR "123" and a Code128 "123" on the same page collapse into one row.

## 6. Text versus bytes (CSV/JSON export)

Source: `ReaderOptions.h` `TextMode`, zxing-wasm `readerOptions.d.ts`, plus experiments with `qrcode` (no ECI) and zxing-wasm's own writer (which always emits an ECI).

- `bytes` is the raw payload and is unaffected by `textMode`. `text` is derived from `bytes`.
- `textMode` defaults to **`HRI`** (what `decode.js` uses today without setting it):
  - For `Text` content it is the plain transcoded string, with multi-line payloads (vCard, with LF or CRLF) preserved.
  - For `Binary`/`Mixed` content it **escapes non-graphical characters as `<NUL>`, `<CR>`, `<LF>`, `<GS>`, `<U+80>`, …**. That string is not round-trippable.
  - For `GS1` content it renders `(01)12345678901231(17)250101(10)LOT42`. `Plain` gives the same payload with no parentheses (`01123456789012311725010110LOT42`).
- Charset handling:
  - A QR with no ECI and UTF-8 bytes is guessed correctly (`Grüße 日本語 😀`). Latin-1 bytes without ECI are also guessed correctly.
  - Invalid UTF-8 (`FF FE 80 41`) falls back to a Latin-1-style rendering with the invalid byte dropped or escaped. `text` is lossy there, and `bytes` is exact.
  - An explicit ECI (UTF-8, Shift_JIS `あい`) is honoured. A binary-ECI (899) payload is rendered as Latin-1, so non-Latin text inside it comes out mojibaked. The writer in zxing-wasm emits ECI 899 for `Uint8Array` input, so my "UTF-8 bytes" test shows `GrÃ¼Ã…` for that case; `bytes` was still exact.
  - `characterSet` is only a fallback when there is no ECI. It had no effect on ECI-tagged symbols.
- 256-byte all-values payload: `contentType: 'Binary'`, `bytes` has all 256 values, and `HRI` text is a long `<NUL><SOH>…` string.

Recommendations for export:

1. Keep `textMode: 'HRI'`. It is the default today, so it is byte-compatible with existing CSV output, and it gives the friendliest GS1 rendering.
2. Add `contentType` to the data model. For `Binary` and `Mixed`, also keep `bytes` and offer it as hex/base64 in JSON.
3. CSV/JSON-escape the text and be explicit that `HRI` of a binary payload contains literal `<NUL>`-style tokens.
4. Don't add a second decode with `Plain` or `Hex`. `bytes` already carries the raw data.

## 7. Wasm variants and size

| Build | Raw (3.1.5) | Raw (3.1.6) | gzip -9 (3.1.5 / 3.1.6) | Contains |
|---|---|---|---|---|
| `reader` | 966,895 B (944 KiB) | 946,860 B (925 KiB) | 417 KB / 410 KB | Everything readable, plus stb_image decoder |
| `full` | 1,546,749 B (1.48 MiB) | 1,544,947 B (1.47 MiB) | 738 KB / 736 KB | Reader + writer |
| `writer` | 647,500 B | 667,014 B | 349 KB / 354 KB | Writer only |

- The README says the reader wasm is "~1.04 MiB". The shipped files are smaller than that, as the table shows.
- The reader build covers **all** readable symbologies. No format is writer-only-gated or full-only-gated. Nothing in the wishlist requires `full`.
- The app already vendors `reader` only (`scripts/build-release.mjs`), so the release size is unchanged by enabling formats.
- Brotli wasn't measured: the local `brotli` tool returned empty output in my shell.
- Side effect of the wasm layer (`readBarcodesFromImage`): when `readBarcodes` is given a `Blob`/`ArrayBuffer`/`Uint8Array`, the wasm decodes the **image** itself with stb_image (JPEG baseline and progressive, PNG, BMP, GIF, TGA, PSD, HDR, PIC, PNM, per the stb_image header). I verified PNG, JPEG (including a progressive 3840 px one) and BMP.
  - **WebP failed** with `Failed to load image from memory`.
  - HEIC, TIFF and AVIF are not in stb_image's list.
  - stb ignores EXIF orientation.
  - So `ImageData` from the browser's canvas pipeline stays the primary path for #20. The Blob path is only a possible shortcut for plain PNG/JPEG.

## 8. Things that surprise the plan or the map's Notes

1. **`decode.js` hard-codes options at module level**, and each worker imports it. Format selection has to be passed per task (for example in the `postMessage` payload) or set per worker per scan session. It cannot stay a module constant. Pipeline-architecture ticket (#25).
2. **Dedupe key** must include `format` (§5). `orderAndDedupeCodes` today drops duplicates by `data` only.
3. **`readBarcodes` can return invalid pseudo-results without `returnErrors`.** Seen for a corrupt `Blob` ("Failed to load image from memory"), an unknown format name, and internal exceptions (`catch` in the wasm layer returns `{error}`). Always filter `isValid`/`format !== ''`, and treat a lone error entry as a failure for the error taxonomy. `decode.js` currently maps whatever comes back, so on a Blob input it would emit an empty-text row.
4. **Default `['QRCode']` already includes Micro QR / rMQR / Model 1** (§3). That is a small behaviour fact for the preset labelling in #26.
5. **UPC-A is reported as EAN-13 (13 digits, leading 0)** under broad selectors, and ITF-14 as ITF. Whoever designs the results schema in #24/#27 should decide whether to show this as-is or normalise.
6. **Map Notes say `decode.js` is "already source-agnostic"**: true for input (it takes `ImageData`), but the options are not source- or session-agnostic (point 1), and results currently only carry `data`/`position`.
7. **Pin hygiene:** `^3.1.5` already floats to 3.1.6 on a fresh install. `package-lock.json` pins 3.1.5. Bump the lock deliberately to 3.1.6 (§1). Behaviour changes between 3.x minors have been small. The breaking changes were all in 3.0.0 (format names, `symbol.data` polarity, removal of `eccLevel`). The repo is already on the post-3.0 names.
8. `ReadResult.format` strings changed in 3.0.0 (e.g. `EAN-13` → `EAN13`, `DataBar` → `DataBarOmni`/`DataBarStk`). Anything that stores or compares format names (CSV columns, saved preferences) should use the 3.x canonical names, and group by `symbology` for stable families.

## 9. Changelog items relevant to a `^3.x` pin

Source: https://github.com/Sec-ant/zxing-wasm/releases (all 3.x releases read).

| Version | Date | Relevant change |
|---|---|---|
| 3.0.0 | 2026-02-24 | zxing-cpp 3.0.2. New canonical format names, `symbology`, meta-formats, `extra` with `ECLevel`, `validateOptionalChecksum`. **Breaking:** `ReadResult.format` values, `eccLevel` removed, `symbol.data` polarity inverted. |
| 3.0.1 | 2026-03-09 | RGBA→grayscale moved to JS (faster `ImageData` reads), several zxing-cpp fixes. |
| 3.0.3 | 2026-05-04 | zxing-cpp bump: DataMatrix and Aztec detector improvements, QR `TraceLine` deadlock fix, PDF417 heap-overflow fixes. |
| 3.1.0 | 2026-06-01 | **MicroPDF417 reading and Telepen support.** |
| 3.1.4 | 2026-09-10 | `rotation` is canonical; `orientation` deprecated. |
| 3.1.5 | 2026-10-06 | zxing-cpp update with decoding and security fixes (the version we lock). |
| 3.1.6 | 2026-10-19 | Fix OOB access for very wide images with `tryDenoise`+`tryDownscale`. Speed-ups (ThinLTO, direct grayscale writes). Fix WASM memory leaks (result vectors released after `readBarcodes`, including on exceptions). Emscripten 6.0.12. |

- Memory check: in 500 consecutive all-format reads of the 2 MP card, the wasm heap stayed flat at 21.3 MiB on both versions. Process RSS settled about 30 MiB lower on 3.1.6 (143 vs 173 MiB). I could not show the leak itself at this scale, so I'm citing the changelog for it and my numbers for the RSS difference.
- Nothing in the 3.x line removes or renames anything the app uses today (`prepareZXingModule`, `readBarcodes`, `formats`, `tryHarder`, `text`, `position`).

## 10. Open items / follow-ups

- **Non-UTF-8 text:** decide whether the results view needs a charset hint column or only the `bytes` hex. (Hangs on #29/#27.)
- **`AllGS1` quirk** and **ISBN-only selector** are unexplained. Neither should become a preset unless re-tested on a future version.
- **Real customer cards** weren't available. The synthetic card is a stand-in. The fixture corpus ticket (#19) should include one real-style card with DataMatrix marks and one with a 1D strip.
- **EAN add-on symbols** (`eanAddOnSymbol: 'Read'`) were not verified: my sample generator did not produce a proper add-on. The setting exists and defaults to `Ignore`.
- **Browser timing:** these numbers are Node/V8 on one machine. A browser run on a mid-range phone (the audience includes mobile) is still needed before committing to "all formats on a 10 MP photo" as a default-safe action. The camera and pipeline tickets (#22, #25) are where it belongs.

## Sources

- zxing-wasm README (formats, presets, build sizes): https://github.com/Sec-ant/zxing-wasm/blob/main/README.md
- zxing-wasm API docs: https://sec-ant.github.io/zxing-wasm/docs/
- zxing-wasm releases / changelog: https://github.com/Sec-ant/zxing-wasm/releases (v3.0.0, v3.1.0, v3.1.4, v3.1.5, v3.1.6)
- zxing-wasm C++ bindings (result fields, `readBarcodesFromImage` via stb_image, error pseudo-results): https://github.com/Sec-ant/zxing-wasm/blob/main/src/cpp/ZXingWasm.cpp
- zxing-wasm build flags and targets: https://github.com/Sec-ant/zxing-wasm/blob/main/src/cpp/CMakeLists.txt
- Installed typings (`dist/es/bindings/readerOptions.d.ts`, `readResult.d.ts`, `barcodeFormat.d.ts`): in `node_modules/zxing-wasm` (3.1.5)
- zxing-cpp `ReaderOptions.h` (option semantics and defaults, TextMode): https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/ReaderOptions.h
- zxing-cpp `Barcode.h` (`extra` keys, `rotation`, `contentType`): https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/core/src/Barcode.h
- zxing-cpp README, supported formats: https://github.com/zxing-cpp/zxing-cpp/blob/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4/README.md
- stb_image supported formats: https://github.com/nothings/stb/blob/master/stb_image.h

## Method note

Experiment scripts and corpora live in `/tmp/opencode/exp-zxing` (outside the repo, not committed). They used zxing-wasm 3.1.5 and 3.1.6 installed there, node-canvas / @napi-rs/canvas, pdfjs-dist 4.10.38, `qrcode`, and the zxing-wasm `full` build's writer to generate samples. The repo's own tests were run against a throwaway copy of `origin/main` with zxing-wasm 3.1.6 swapped in; both with the current `['QRCode']` and with `formats: []`.
