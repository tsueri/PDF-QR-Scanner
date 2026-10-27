# Fixture corpus for the universal barcode scanner map

Built for [ticket #19](https://github.com/tsueri/PDF-QR-Scanner/issues/19) ("Assemble a
multi-format fixture corpus", child of the wayfinder map
[#18](https://github.com/tsueri/PDF-QR-Scanner/issues/18)). Planning asset only — nothing
here belongs on `main` until a milestone decision says so; this branch is throwaway.

## What is here

`corpus/` — 53 fixtures + `manifest.json` (ground truth + observed decode results per file):

| Group | Files | Purpose |
|---|---|---|
| `qr-same-payload/` | PNG, JPEG, WebP, GIF, BMP, AVIF, SVG, transparent PNG | same payload (`https://example.com/fixt/0001`) in every browser-decodable container; the transparent PNG documents the flatten-on-white gotcha (0 codes raw, 1 after flattening) |
| `orientation/` | 2 JPEGs | EXIF orientation 6 / 8, rotation by metadata only |
| `large/` | 12 MP JPEG, 48 MP JPEG, 144 MP PNG "bomb" | corner QR in big photos; the bomb (12000²) is the oversize-policy test case — browsers accept it, zxing decodes it via `tryDownscale`, no device pixel budget survives it |
| `quality/` | 4 files | low contrast (26% delta), skewed+shear, centre occlusion over an EC-H symbol, baked 90° rotation without EXIF — all decode with zxing defaults on 3.1.6 |
| `symbologies/` | 17 files | EAN-13 (+5-digit add-on), Code 128, DataMatrix, PDF417, Aztec, UPC-A, ITF-14, GS1 (Code128 + DataMatrix), Telepen alpha/numeric, binary QR, all-256-bytes QR, Micro QR, rMQR, inverted QR, and a 2×4 mixed-symbologies grid |
| `cards/` | 2 PDFs | real-style customer cards: QR + 4 corner DataMatrix marks; the second adds a Code128 strip. Default `['QRCode']` returns only the QR; all formats returns 5/6 codes |
| `heic-tiff/` | HEIC, multi-page TIFF | 12 MP HEIC (Safari-native or lazy libheif-js fallback) and a 3-page CCITT G4 TIFF (pages carry A, A, B — the per-page + dedupe case) |
| `trees/` | folder tree + ZIP | mixed images + a 2-page PDF; `card-1.png` exists in two subfolders with different payloads (duplicate-basename case) |
| `pdf/` | 2 PDFs | `example.pdf` byte-identical to the repo's (baseline for the `page,qr-code` CSV), plus a two-page PDF with one distinct payload per page |
| `guards/` | 4 files | photo / dense text / RGB noise / flat white — expect 0 codes under every format selection |

`manifest.json` records per fixture: expected payloads, expected result counts, the
**observed** results (zxing-wasm **3.1.6** reader, default options), a decoder note
(`libheif-js` for the HEIC, `utif2` for the TIFF, `pdftoppm` for PDFs, magick/ffmpeg for
WebP/BMP/AVIF/SVG container loading), and a sha256 + size for every file.

Observed facts worth keeping in mind (all in the manifest with details):

- Default `['QRCode']` root also reads **Micro QR and rMQR** (#23 §3, now fixture-proven).
- **UPC-A reads back as EAN-13** with a leading 0; **ITF-14 reads back as ITF**.
- **Telepen Numeric misreads as TelepenAlpha** (garbage text) under broad selectors; only a
  narrow `['TelepenNumeric']` read is correct.
- **EAN add-ons** are returned only with `eanAddOnSymbol: 'Read'` (default `Ignore` gives
  the main symbol only) — the unverified case from #23 §10, now fixture-backed.
- GS1 symbols carry `contentType: 'GS1'` and `]C1` / `]d2` symbology identifiers.
- Binary QR (written from `Uint8Array`) carries `contentType: 'Binary'`; `text` is
  HRI-escaped, `bytes` is exact.

## Regenerating

Everything is deterministic (seeded PRNG, fixed encoder settings). Requirements: Node 22,
`npm install`, plus `magick` (ImageMagick 7), `ffmpeg` 8 (AVIF), `exiftool`, `zip`,
`python3` with `pillow-heif` (HEIC) and Pillow (multi-page G4 TIFF), `pdftoppm`
(poppler, PDF verification).

```sh
npm install
npm run generate   # writes corpus/ + corpus/manifest.expected.json
npm run verify     # decodes everything with zxing-wasm 3.1.6, writes corpus/manifest.json
```

Barcodes are written with the repo's own stack: `qrcode` (dev dependency) for plain QRs,
the zxing-wasm **full** build's writer for every other symbology, `pdfkit` for PDFs,
node-canvas for scenes. Generation is ~2 min, verification ~1 min on the reference machine.

Caveats: the HEIC is a single-image pillow-heif/x265 file — real iPhone grid/HDR/gain-map
HEICs are not covered (that is ticket #33's device check). Measured in Node on Linux;
browser-specific behaviour (EXIF orientation, transparency, canvas caps) is cited from the
research tickets, not re-measured here.