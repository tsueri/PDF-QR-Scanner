// Verifies the fixture corpus against zxing-wasm 3.1.6 (the repo's decoder) and writes
// the final manifest.json: expected payloads + observed decode results per fixture.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createCanvas, loadImage, ImageData as NCImageData } from 'canvas';
import JSZip from 'jszip';
import * as zxingReader from 'zxing-wasm/reader';

const ROOT = new URL('.', import.meta.url).pathname;
const C = path.join(ROOT, 'corpus');
const require_ = createRequire(import.meta.url);
const libheif = require_('libheif-js');
const UTIF = require_('utif2');

const wasmReader = readFileSync(new URL('./node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url));
await zxingReader.prepareZXingModule({ overrides: { wasmBinary: wasmReader }, fireImmediately: true });
const READER = `zxing-wasm ${zxingReader.ZXING_WASM_VERSION || '3.1.6'}`;

const expected = JSON.parse(readFileSync(path.join(C, 'manifest.expected.json'), 'utf8'));
const TMP = mkdtempSync(path.join(tmpdir(), 'fixverify-'));

const imageDataOf = c => c.getContext('2d').getImageData(0, 0, c.width, c.height);
// draw a decoded Image onto a transparent canvas (no white pre-fill: alpha must survive for the raw-alpha case)
function imgData(img) {
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return imageDataOf(c);
}

// ---- load a raster file into ImageData (mirroring what the browser pipeline would produce) ----
async function rgbaOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif') return imgData(await loadImage(file));
  if (ext === '.webp' || ext === '.bmp' || ext === '.svg') {
    const out = path.join(TMP, path.basename(file) + '.png');
    execFileSync('magick', [file, '-background', 'white', '-flatten', out]);
    return imgData(await loadImage(out));
  }
  if (ext === '.avif') {
    const out = path.join(TMP, path.basename(file) + '.png');
    execFileSync('ffmpeg', ['-y', '-i', file, '-frames:v', '1', '-update', '1', out]);
    return imgData(await loadImage(out));
  }
  if (ext === '.heic') return heicRgba(file);
  if (ext === '.tiff' || ext === '.tif') return tiffPages(file);
  throw new Error('no loader for ' + ext);
}
function heicRgba(file) {
  const buf = readFileSync(file);
  const data = new libheif.HeifDecoder().decode(buf);
  const img = data[0];
  const w = img.get_width(), h = img.get_height();
  return new Promise((res, rej) => {
    img.display({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }, (d) => {
      if (!d) return rej(new Error('libheif display failed'));
      const c = createCanvas(w, h);
      c.getContext('2d').putImageData(new NCImageData(new Uint8ClampedArray(d.data), w, h), 0, 0);
      res(imageDataOf(c));
    });
  });
}
function tiffPages(file) {
  const buf = new Uint8Array(readFileSync(file));
  const ifds = UTIF.decode(buf);
  const pages = [];
  for (const ifd of ifds) {
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const c = createCanvas(ifd.width, ifd.height);
    c.getContext('2d').putImageData(new NCImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), ifd.width, ifd.height), 0, 0);
    pages.push(imageDataOf(c));
  }
  return { pages, ifdCount: ifds.length };
}
const FONTS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
// Rasterize PDFs with poppler's pdftoppm (an independent renderer; 144 dpi = the app's 2× A4 scale).
async function pdfPages(file, scale = 2.0) {
  const dpi = Math.round(72 * scale);
  const prefix = path.join(TMP, path.basename(file, '.pdf'));
  execFileSync('pdftoppm', ['-r', String(dpi), '-png', file, prefix]);
  const pngs = readdirSync(TMP).filter(f => f.startsWith(path.basename(prefix) + '-')).sort();
  const pages = [];
  for (const f of pngs) {
    const img = await loadImage(path.join(TMP, f));
    const c = createCanvas(img.width, img.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0);
    pages.push(imageDataOf(c));
  }
  return { pages, pageCount: pages.length };
}

// ---- decode helpers ----
const DEFAULT_QR = { formats: ['QRCode'] };                       // the app's current default
const ALL = { formats: [], tryHarder: true };                     // zxing defaults, all formats
const clean = rs => rs.filter(r => r.isValid && r.format).map(r => ({
  format: r.format, symbology: r.symbology, contentType: r.contentType,
  symbologyIdentifier: r.symbologyIdentifier,
  text: r.text.length > 120 ? r.text.slice(0, 117) + '...' : r.text,
  bytesB64: r.bytes && r.bytes.length ? Buffer.from(r.bytes).toString('base64') : undefined,
}));
async function read(imageData, opts) { return clean(await zxingReader.readBarcodes(imageData, { tryHarder: true, ...opts })); }

const sha256 = f => require_('crypto').createHash('sha256').update(readFileSync(f)).digest('hex');

// ---- walk corpus files that the manifest does not enumerate per-file ----
function filesUnder(dir) {
  const base = path.join(C, dir);
  return readdirSync(base).filter(f => !f.startsWith('.') && !f.startsWith('manifest') && statSync(path.join(base, f)).isFile()).sort();
}

const results = [];
for (const e of expected.entries) {
  const v = { reader: READER };
  if (e.id === 'same-payload') {
    v.files = {};
    for (const f of filesUnder(e.dir)) {
      const id = await rgbaOf(path.join(C, e.dir, f));
      const modes = {};
      if (f === 'qr-transparent.png') {
        modes.rawAlphaKept = (await read(id, DEFAULT_QR)).length;                    // expect 0
        const src = createCanvas(id.width, id.height);
        src.getContext('2d').putImageData(id, 0, 0);
        const c = createCanvas(id.width, id.height); const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(src, 0, 0);                                                      // composite, like the app pipeline
        modes.flattenedOnWhite = (await read(imageDataOf(c), DEFAULT_QR)).length;    // expect 1
      } else {
        modes.defaultQR = (await read(id, DEFAULT_QR)).length;
        modes.allFormats = (await read(id, ALL)).length;
      }
      v.files[f] = { modes, pixels: `${id.width}x${id.height}` };
    }
  } else if (e.id === 'symbologies') {
    v.samples = {};
    for (const s of e.samples) {
      const id = await rgbaOf(path.join(C, e.dir, s.file));
      const modes = { defaultQR: (await read(id, DEFAULT_QR)).length, allFormats: (await read(id, ALL)).length, observed: await read(id, ALL) };
      if (s.file === 'ean13-addon5.png') modes.addonRead = (await read(id, { ...ALL, eanAddOnSymbol: 'Read' })).length;
      if (s.file === 'telepen-numeric.png') modes.narrow = await read(id, { formats: ['TelepenNumeric'], tryHarder: true });
      v.samples[s.file] = modes;
    }
    const mixId = await rgbaOf(path.join(C, e.dir, 'mixed-symbologies.png'));
    v.mixed = { observed: await read(mixId, ALL), defaultQR: (await read(mixId, DEFAULT_QR)).length };
  } else if (e.id === 'customer-card-dm' || e.id === 'customer-card-1d') {
    const { pages } = await pdfPages(path.join(C, e.dir, e.file));
    const pg = pages[0];
    v.defaultQR = (await read(pg, DEFAULT_QR)).length;
    v.allFormats = (await read(pg, ALL)).length;
    v.observed = await read(pg, ALL);
  } else if (e.id === 'heic-12mp') {
    const id = await rgbaOf(path.join(C, e.dir, e.file));
    v.defaultQR = (await read(id, DEFAULT_QR)).length;
    v.allFormats = (await read(id, ALL)).length;
    v.decodedBy = 'libheif-js 1.23.x (the app fallback-tier decoder, #21)';
  } else if (e.id === 'tiff-multipage-g4') {
    const { pages, ifdCount } = await rgbaOf(path.join(C, e.dir, e.file));
    v.ifdCount = ifdCount;
    v.pages = [];
    for (const pg of pages) {
      v.pages.push({ defaultQR: (await read(pg, DEFAULT_QR)).length, allFormats: (await read(pg, ALL)).length, observed: await read(pg, DEFAULT_QR) });
    }
    v.decodedBy = 'utif2 4.1.0 (the TIFF decoder picked by #21)';
  } else if (e.id === 'tree-mixed') {
    v.zip = {};
    const zip = await JSZip.loadAsync(readFileSync(path.join(C, 'trees', 'tree-mixed.zip')));
    v.zip.entries = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
    v.files = {};
    for (const rel of e.files) {
      const f = path.join(C, 'trees', rel);
      if (f.endsWith('.pdf')) {
        const { pages } = await pdfPages(f);
        v.files[rel] = [];
        for (const pg of pages) v.files[rel].push(await read(pg, DEFAULT_QR));
      } else {
        const id = imgData(await loadImage(f));
        v.files[rel] = await read(id, ALL);
      }
    }
  } else if (e.id === 'pdf-baseline') {
    v.files = {};
    for (const f of filesUnder(e.dir)) {
      const { pages, pageCount } = await pdfPages(path.join(C, e.dir, f));
      v.files[f] = { pageCount, pages: [] };
      for (const pg of pages) v.files[f].pages.push(await read(pg, DEFAULT_QR));
    }
  } else {
    // quality / orientation / large / guards: each file in the dir
    v.files = {};
    for (const f of filesUnder(e.dir)) {
      const id = await rgbaOf(path.join(C, e.dir, f));
      v.files[f] = { defaultQR: (await read(id, DEFAULT_QR)).length, allFormats: (await read(id, ALL)).length, pixels: `${id.width}x${id.height}`, observed: await read(id, DEFAULT_QR) };
    }
  }
  results.push({ ...e, verified: v });
  console.log('verified:', e.id);
}

// ---- integrity: sizes + hashes for every corpus file ----
const integrity = [];
(function walk(d) {
  for (const f of readdirSync(d).sort()) {
    if (f.startsWith('manifest') || f.startsWith('.')) continue;
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const relPath = path.relative(C, p);
    integrity.push({ file: relPath, bytes: statSync(p).size, sha256: sha256(p) });
  }
})(C);

const manifest = {
  name: 'PDF-QR-Scanner universal-scanner fixture corpus',
  ticket: 'https://github.com/tsueri/PDF-QR-Scanner/issues/19',
  reader: READER,
  decoderNotes: 'Observed results use zxing-wasm reader defaults (tryHarder/tryRotate/tryInvert/tryDownscale on, returnErrors off). Raster loading mirrors the app pipeline: canvas -> ImageData; containers the canvas cannot load were converted with magick/ffmpeg before decoding.',
  entries: results,
  integrity,
};
writeFileSync(path.join(C, 'manifest.json'), JSON.stringify(manifest, null, 2));
rmSync(TMP, { recursive: true, force: true });
console.log('manifest.json written:', results.length, 'entries,', integrity.length, 'files hashed');