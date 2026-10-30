# Milestone 1 — Widen the intake, ship the results view

**Hand-off spec.** Assembled from the wayfinder map [Universal barcode scanner — any input, any format](https://github.com/tsueri/PDF-QR-Scanner/issues/18) (closed tickets #24, #25, #27, #28, #29, #31, #32, #33, #34, #35; research #19–#23). Domain terms live in [`CONTEXT.md`](../../CONTEXT.md); this document uses them without redefinition. M1 is the first of four versioned releases; the M2–M4 order is stated at the end. Building is out of scope of the map that produced this spec — this document is the hand-off.

**M1 in one line:** the app widens from PDF-only to a general-purpose scanner — files, folders, ZIPs and pasted images go in, a source-card results view with copy and export comes out — while the PDF batch flow stays intact and QR-only decoding is unchanged.

---

## 1. Scope

**In M1:**

- Widened intake: one drop zone for PDFs, image files, folder drops and ZIP archives; paste-image entry point; camera entry point as a **stub** (no live scanning — the camera surface is M3).
- One source-agnostic pipeline driver (`scanSource`) over lazy adapters, replacing the PDF-shaped loop, with `scanPDF` kept as a frozen-signature wrapper.
- Magic-byte type detection; containers expand at intake into one source per member.
- Source-card results view with copy, CSV, JSON and ZIP export.
- One RFC 4180 CSV writer for every source; PDF CSV header renamed `page,qr-code` → `page,data` (byte-compatibility deliberately relaxed to schema-compatibility, per #27).
- Error taxonomy for the new sources (#34) with source failures and item failures.
- Open action in the results view for whitelisted schemes (#35).
- CI: minimal GitHub Actions workflow.
- `THIRD-PARTY-NOTICES` (pdf.js Apache-2.0, zxing Apache-2.0, jszip MIT) — per #31.

**Explicitly out of M1 (later milestones):**

- **Symbology selection UI** — M2. M1 reads QR-only, with the per-task options plumbing already in place (`decodeImageData(imageData, readerOptions)`), file defaults `{ tryHarder: true, formats: ['QRCode'] }`.
- **Live camera** — M3. The intake's "Scan with camera" button is a stub-level entry point.
- **HEIC / TIFF decoding** — M4. HEIC is not in the accept list; HEIC on non-Safari browsers surfaces as `unsupported-format`. TIFF/utif2 is not in M1.
- **SVG** — out of milestone 1 entirely (needs main-thread rasterisation; the adapter seam keeps it possible later). Not in the accept list.
- **URL fetch, screen/window capture** — ruled out of the effort entirely (privacy / CORS).

## 2. Domain model (per #24)

- **Sighting** is the atomic record: a **code** (symbology + payload) plus where it was found (source, item locator, position). A **result** is a sighting that survived dedupe; results are what the app shows and exports. Same payload on page 1 and page 5 is two sightings, two results. Grouping by code is a display choice only.
- **Item** is the decoder's unit: a PDF page, a whole image, a camera frame. **Locator** is its 1-based index within the source. Animated GIF contributes its first frame as one item.
- **Dedupe** keys on `(symbology, payload)`, scoped per item for file sources, never across sources. (Camera coalescing is M3, per #36.)
- **Containers** (ZIP, folder) are not sources: they expand at intake into one source per scannable member. **Origin is identity** (file path, archive-member path including the archive's own path, clipboard, camera); **name** is display-only and may collide — the duplicate-name check in `addFiles` is retired. Nested ZIPs recurse with a depth cap (~3) plus per-container member/size caps.
- **Paste** is not a source kind of its own: an image source whose origin is the clipboard, name fallback "Pasted image".
- Result fields — code side: symbology (zxing's format string; pretty names are a mapping concern), payload text, raw bytes + content type for binary payloads. Sighting side: source, locator, position (optional). Ordering within an item stays reading order (top-to-bottom, then left-to-right).

## 3. Pipeline architecture (per #25)

### 3.1 Driver and adapters

```js
// scan.js
scanSource(source, { onProgress, readerOptions }) -> Result[]
// source: { kind, inspect(): Promise<Inspect>, items(): AsyncIterator<{ locator, imageData }> }
scanPDF(pdfDoc, options) -> Result[]          // frozen wrapper — unchanged public signature and observable behaviour
// decode.js
decodeImageData(imageData, readerOptions) -> Code[]   // { symbology, payload, position, ... }, isValid-filtered
orderAndDedupeCodes(locator, codes) -> Sighting[]
// pool
pool.scan(imageData, readerOptions) -> Code[] | null
```

- `scanSource` owns everything `scanPDF`'s loop owns today: pool acquisition, render-ahead batching (`pool.size * 2`, one batch in flight), progress, reading-order sorting, per-item dedupe.
- An **adapter** is `inspect()` (intake-time metadata and early errors: page count, dimensions, password/corrupt load errors — runs when the file is added so the UI can show "12p" or an error before scanning) plus `items()` (lazy async iterator of `{ locator, imageData }`, already rasterised).
- `scanPDF(pdfDoc, options) = scanSource(pdfAdapter(pdfDoc), options)` — the WebMCP `scan-loaded-pdf` tool and the integration suite keep working untouched.
- PDF-specific code (pdfjs render at 2x scale + 4x retry pass, page counts, password errors) lives only inside the PDF adapter. Nothing else in the pipeline knows what a page is.

### 3.2 Rasterisation placement

- **PDF:** unchanged — main-thread pdfjs render into a canvas, `getImageData`, feed the pool.
- **Images:** one dedicated **decode worker**: `createImageBitmap(file)` (EXIF orientation applied by default) → draw onto a white-pre-filled `OffscreenCanvas` → `getImageData` → transfer → feed the existing scan pool. **White pre-fill is mandatory**: transparent-PNG QR codes read as 0 codes otherwise.
- **Camera (M3):** its own latest-frame-wins worker; not part of M1 beyond the stub.

### 3.3 Oversize policy — mechanism and constants

Two thresholds, as named constants in one module:

- **In-flight pixel budget** gates concurrent decodes; over it → **queue** (never a degraded path). Measured peak on the bitmap path is ~15 B per source pixel (~0.7 GB at 48 MP), so the budget default admits one 48 MP decode in flight (~750 MB); tunable.
- **Per-image cap** — a single image too big to decode safely; over it → zxing **Blob path** (stb-supported containers only: PNG/JPEG/BMP/GIF, ~2.8 B/px) → **tile-crop** from one decoded `ImageBitmap` → **reject** with `oversize-rejected`.
- **Runtime marker probe** — draw a marker pixel and read it back, to catch Chromium's silently blank canvas above 16384² px and route to fallback. Blank-canvas detection is `corrupt-image` (per #34).
- **Header-sniffed dimensions** reject absurd sizes before allocating.
- **No downscaling by default** — shrinking loses small QR codes (a 4.3 px/module QR is lost at 2000 px, found at 3000 px); full-res 48 MP decode is ~0.2–0.6 s of wasm.
- **Canvas-area floor: 8192²** — first measured confirmation on iOS Safari 18.7 (#33: 8192² works, 10000² is blank). A 48 MP photo (8000×6000) succeeds end-to-end (~145 ms decode in the worker). Constants are retuned only by further device evidence, in one module, per #25.

### 3.4 Worker-optional everywhere

The decode worker, scan pool, and camera worker are all optional. Without workers/`OffscreenCanvas` (including ≤2 cores, where `_getPool()` already returns `null`), rasterisation and decoding run on the main thread behind the same functions and the same budget gate. No source kind hard-fails because workers are missing; it just gets slower.

### 3.5 Type detection

Magic bytes are the authority: sniff the first bytes (`%PDF-`; PNG/JPEG/GIF/BMP/WebP/TIFF signatures; `PK` → container). `file.type` is a UI hint only; the extension is not consulted. Unknown bytes → "unsupported file" error at intake. A pasted image is always an image, no sniff.

### 3.6 App state

One unified `sources` array replaces `fileEntries`: `{ id, origin, name, kind, inspect, state, locator, locatorCount, codes, results, errorMessage, adapter }`. The pdfjs document lives inside the PDF adapter/closure, not as a field. One render path serves every kind. Camera sessions are not entries here — they are their own surface (M3).

### 3.7 zxing-wasm

Pin `^3.1.6`, `reader` build only (reads all 14 symbology roots / 41 variants; `full` only adds a writer). Options travel **per task** — the module-level constant is gone. Results are `isValid`-filtered immediately after `readBarcodes`, before dedupe; invalid pseudo-results are dropped, never surfaced as codes.

## 4. Intake UI (per #28 — Variant A · One zone, picked by @tsueri)

- **One drop zone** accepting PDFs, image files (PNG · JPG · WebP · GIF *(first frame)* · BMP · AVIF), folder drops, and ZIP archives; a browse link and a separate "choose folder…" input both reachable adjacent to the zone.
- **Secondary entry points** in a row beneath the zone: **Paste image** button and **Scan with camera** (stub).
- **Queue:** the existing file-row design, widened — per-source **type pill** (PDF / Image / Pasted / Camera), existing state badges and per-source progress bars unchanged; container members listed flat with an **origin subline** (`batch-2026.zip › docs/`); duplicate basenames allowed (origin is identity).
- **Unsupported files:** error rows in the queue ("Can't read this file type"); no separate summary strip.
- **Copy:** headline "Scan QR codes and barcodes"; drop hint "Drop files, folders or ZIPs here, or browse"; accepted-types line including the GIF first-frame note; footer "Privacy by design — your files stay on your device." (Final copy polish belongs to the rename/rebrand work, not this milestone.)
- **Aggregate bar:** "x of y sources done", hidden until a scan starts.
- **Paste on mobile:** `navigator.clipboard.read()` alone is unreliable (frequent blocks / gesture rules); the implementation **must** name a paste-event fallback (e.g. a `paste` event listener handling `clipboardData.items`).
- Accepted-types: no SVG (§1); no HEIC/TIFF (M4). Unsupported files surface as `unsupported-format` error rows.

## 5. Results view (per #29 — Variant B · Source cards) and Open action (per #35)

- **One card per source** that produced sightings (or was empty), collapsible, open by default; empty sources stay collapsed and dimmed with "No codes found" in the body.
- **Card head:** type pill + name + origin subline + "n pages/frames/images · m codes" meta + chevron.
- **Per-source actions in the head:** *Copy source* (payload per line, HRI-escaped) and *CSV* (that source's CSV file, per §6 naming).
- **Run summary strip** in the banner's slot (replaces the "ZIP ready" banner): "N codes · M of K sources · x empty · N failed" + **Copy all** / **JSON** / **Download**. Neutral grey, not the green banner — a status, not a success flash.
- **Download adapts:** bare CSV when exactly 1 source has results, `barcodes.zip` for 2+ (per #27).
- **Result rows:** locator chip (`p.3` / `frame 12`, hidden for single-item sources), symbology badge, payload in mono with 2-line clamp + Show more; binary payloads show `binary · content type · n bytes` instead of raw bytes — never raw bytes on screen. Row actions: **Copy** always; **Open** per the scheme whitelist below.
- **Open action (per #35):** appears only for payloads with an explicit `https:`/`http:`/`tel:`/`mailto:` scheme.
  - `http(s):` → new tab: `target="_blank" rel="noopener noreferrer"`.
  - `tel:`/`mailto:` → plain link, no `target` (OS handler takes over; no blank tab).
  - Everything else (`javascript:`, `data:`, custom schemes, scheme-less) never renders an Open action — the row keeps raw payload text.
  - **No confirmation step**; label "Open"; accessible description names the host ("Open example.com in a new tab"; tel/mailto: "Open phone dialer" / "Open email app").
  - **No scheme-less sniffing** — an explicit scheme is a security property.
  - Structured payloads (vCard, Wi-Fi, geo, JSON) stay raw in M1; typed hints are deliberately open (map fog).
- **Copy uses HRI-escaped text** (`\xNN` for control chars), matching the CSV/clipboard decision.
- **Queue rows behind the view** carry the same pills/origin sublines as the intake.

## 6. Output schema (per #27)

**CSV.** One RFC 4180-correct writer for every source (embedded quotes doubled; embedded newlines quoted; the old writer's quoting bug is retired). One schema per source kind:

- PDF sources: `page,data` — unchanged shape, header renamed from `qr-code`. Golden-file test asserts the new format (byte-equality with old output is deliberately not kept).
- Non-PDF sources: `source,locator,symbology,data` — source name, item locator (page number / frame number / `1` for a whole image), zxing symbology name, payload text.

**Packaging.** 2+ sources → `barcodes.zip`, one CSV per source inside. Exactly 1 source → a bare CSV download, no ZIP (this changes today's always-ZIP delivery for a single PDF; the CSV bytes and naming are unchanged). Empty sources are excluded from the ZIP.

**Naming.** ZIP members flatten to basenames with ` (n)` collision suffixes — no folder structure inside the export ZIP. Unnamed sources: `pasted.csv`, `camera.csv`, same ` (n)` suffix. No timestamps in file names.

**JSON.** One run-level `barcodes.json`:

```json
{
  "version": 1,
  "scannedAt": "2026-10-29T12:00:00Z",
  "selection": { "preset": "qrcode", "symbologies": ["QRCode"] },
  "sources": [
    {
      "name": "doc.pdf",
      "kind": "pdf",
      "origin": "…path or zip://… or camera…",
      "items": 12,
      "codes": [
        {
          "symbology": "QRCode",
          "payload": "…",
          "contentType": "Text",
          "bytes": null,
          "locator": 1,
          "position": { "corners": [[x, y]] },
          "capturedAt": null
        }
      ]
    }
  ]
}
```

- `bytes` is base64 of the raw payload for non-text content (null otherwise); `position` carries corner points when available; `capturedAt` is a timestamp only for camera frames (null elsewhere).
- **Failed sources** are excluded from CSV/ZIP; the JSON gains a top-level `failed` array: `origin`, `kind`, `message`, and per-item failures with locators. No separate `failed.csv`.
- In M1, `selection` is the fixed default (the selection UI is M2). The schema is fixed as above; per #32, populating `contentType`/`bytes` is accepted in M2 — M1 emits text defaults (`contentType: "Text"`, `bytes: null`), and binary payloads stay HRI-escaped in CSV/clipboard per this section. If a binary QR payload arrives in M1, the HRI-escaped text is what ships.
- **Symbology reporting:** as returned — no UPC-A (reported as EAN-13 with a leading 0) or ITF-14 (reported as ITF) normalisation. Dedup identity stays `(symbology, payload)`.
- **WebMCP `scan-loaded-pdf`:** same CSV text, now `page,data`. The `symbologies` param lands with M2.

## 7. Error taxonomy (per #34)

- Failures live on **both source and item**. A **source failure** produced no results at all (intake rejection, undecodable image, oversize-rejected, refused camera). An **item failure** is one item failed while others scanned (each with its locator). Container failures surface as an error row in the queue for the container itself. **No error ever attaches to a result.**
- One closed namespace of **failure kinds**, each with one user-facing message naming a distinct remediation:

| Where | Kinds |
|---|---|
| Source (intake/decode) | `unsupported-format`, `corrupt-image` (also covers PDF open failures, message per source type), `unsupported-variant`, `oversize-rejected`, `password-protected` |
| Container | `bad-archive`, `encrypted-archive`, `nested-cap-exceeded` |
| Paste | `empty-clipboard`, `paste-not-image` |
| Item (decode) | `decode-failed` |
| Camera (M3) | `permission-denied`, `no-camera`, `camera-busy`, `constraints-unsupported` |

- Existing PDF categories map: load error → `unsupported-format`/`corrupt-image`; password → `password-protected`; scan error → `decode-failed`; **empty stays a neutral state, not an error**.
- **Decode seam stops swallowing:** `decodeImageData` returns `{ codes: [] }` on a clean empty read and throws (or returns `{ error }`) on a genuine failure — a throw from `readBarcodes`, or a lone `isValid:false` pseudo-result (that becomes `decode-failed`). The pool's message shape carries codes **or** an error, never a silently empty array for a failed read.
- **"0 codes found is not proof of absence"** is a voice constraint: no uncertainty markers, no hedged wording; empty stays factual ("No codes found in this image"). Detectable truncation (throw, zero-size decode, blank-canvas probe) becomes `corrupt-image`.
- **Surface:** failed sources are their own source cards carrying the failure message; per-item failures appear as locator rows inside the card; the summary strip gains "N failed". Intake error rows are the same data surfaced earlier.

## 8. Regression guards and acceptance criteria (per #32)

The four mandatory guards per milestone, plus the M1-specific ones:

1. `npm test` (regression + CSV + zip) passes.
2. `tests/test-regression.cjs` updated **in the same commit** as the `decode.js` signature change (locator + `(symbology, payload)` key), gaining: a DataMatrix fixture asserting symbology is recorded; duplicate `(symbology, payload)` within one item collapsed; the same payload in two items kept.
3. Golden-file guards for the new CSV (`page,data`) and `barcodes.json` formats.
4. Puppeteer PDF-flow integration test (`npm run test:integration`) passes with **zero behavioural change** — same PDF batch flow, same ZIP bytes, same UI states.
5. **Adapter ≡ `scanPDF` equivalence test:** the PDF adapter through `scanSource` produces exactly what `scanPDF` produced.
6. Per-adapter unit tests over the fixture corpus (#19).
7. The results-view prototype's interaction tests (`tests/test-results-prototype.mjs` on `prototype/results-view`) move into the milestone-1 suite and guard the Open-action whitelist: one Open action only for whitelisted schemes, correct `href`/`target`/`rel` per scheme class, copy still writing the raw payload.
8. `THIRD-PARTY-NOTICES` ships (pdf.js, zxing, jszip).
9. Release build (`scripts/build-release.mjs`) runs; versioned zip attached; README + `llms.txt` + CHANGELOG refreshed.

**CI (new in M1):** minimal GitHub Actions — `npm test` on every push, `npm run test:integration` on PRs, corpus excluded from the default run.

**Versioning:** each milestone is a versioned release (M1 = 1.5.0) and shippable on its own. Camera stays a stub and symbologies stay QR-only until their milestone.

## 9. Milestones after M1 (order per #32)

- **M2 — Symbology selection.** Presets ("QR codes" default · "1D barcodes" · "2D barcodes" · "Everything") + collapsed Custom expander over zxing's 14 symbology roots; localStorage persistence with validation-and-fallback; one global selection captured at scan start and locked during a run; `contentType`/`bytes` populated in JSON; WebMCP `scan-loaded-pdf` `symbologies` param.
- **M3 — Camera.** Variant A full-screen takeover (per #30/#36): continuous default with a one-shot toggle, run-collapsing dedupe with ×N re-sightings, 10 decodes/s throttle (provisional), pre-permission card, real `<dialog>`/`showModal()` overlay, one-shot confirm panel, latest-frame-wins worker, camera source card. Gated on #36 (closed).
- **M4 — HEIC and TIFF.** HEIC native-only (Safari 17+, clear "convert to JPEG first" error elsewhere — the iOS Photos picker auto-converts to JPEG anyway, #33); multi-page TIFF via `utif2`, one TIFF page = one item. No libheif-js wasm fallback (LGPL-3.0 + HEVC-patent cost not accepted; kept behind the adapter seam).

## 10. Assets

- **Fixture corpus** (#19): branch `research/fixture-corpus`, `research/fixture-corpus/` — 53 deterministic fixtures with `manifest.json` ground truth; regenerate `npm run generate && npm run verify`.
- **Intake prototype** (#28): branch `prototype/unified-intake` (`src/prototype/intake.js` + `intake.css`, `?variant=a|b|c`; screenshots in `src/prototype/screenshots/`).
- **Results-view prototype** (#29): branch `prototype/results-view` (`src/prototype/results.js` + `results.css`, `?variant=a|b|c&run=mixed|big|camera`; test suite `tests/test-results-prototype.mjs`).
- **Camera prototype** (#30/#33): branch `prototype/camera-ux` (`?camera=a|b|c`; device-check harness + `device-check/findings.md`).
- **Research write-ups:** `research/browser-image-decoding.md` (#20), `research/zxing-multiformat.md` (#23), `research/camera-capture.md` (#22), `research/heic-tiff.md` (#21) on their `research/*` branches.

## 11. Open questions

**None for milestone 1.** Every decision M1 depends on is recorded above with its source ticket. Deliberately-open items that do **not** gate M1: typed payload hints (fog, judged after M1 ships), structured-append reassembly (fog), rename/rebrand + surface docs (after M4), HEIC wasm fallback (only on real demand), iPhone HEIC variant validation (implementation-phase check riding with the M4 build — ruled out of scope of the map, as is the real-device thermal/battery validation of the camera throttle cap riding with M3).
