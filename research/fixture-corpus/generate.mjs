// Fixture corpus for PDF-QR-Scanner map #19 — "Assemble a multi-format fixture corpus".
// Generates every fixture under ./corpus and seeds ./manifest.json with expected payloads.
// Observed decode results are added later by verify.mjs.
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createCanvas, loadImage, Image } from 'canvas';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import * as zxingFull from 'zxing-wasm/full';
import * as zxingReader from 'zxing-wasm/reader';
import { readFileSync } from 'node:fs';

const ROOT = new URL('.', import.meta.url).pathname;
const C = path.join(ROOT, 'corpus');
for (const d of ['qr-same-payload', 'orientation', 'large', 'quality', 'symbologies', 'cards', 'heic-tiff', 'trees/tree-mixed/cards', 'trees/tree-mixed/reports', 'trees/tree-mixed/docs', 'trees/tree-mixed/invoices', 'pdf', 'guards'])
  mkdirSync(path.join(C, d), { recursive: true });

// ---- warm zxing (writer + reader), pinned to the package's own wasm ----
const wasmFull = readFileSync(new URL('./node_modules/zxing-wasm/dist/full/zxing_full.wasm', import.meta.url));
const wasmReader = readFileSync(new URL('./node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url));
zxingFull.prepareZXingModule({ overrides: { wasmBinary: wasmFull }, fireImmediately: true });
zxingReader.prepareZXingModule({ overrides: { wasmBinary: wasmReader }, fireImmediately: true });

// ---- payload registry (single source of truth, mirrored into the manifest) ----
export const P = {
  A: 'https://example.com/fixt/0001',            // shared payload across all containers
  B: 'https://example.com/fixt/0002',
  MARK_A: 'MARK-A1', MARK_B: 'MARK-B2',
  CUST_URL: 'https://example.com/customer/0042?token=abc123',
  CUST_NO: 'CUST-000042',
  TREE1: 'https://example.com/fixt/tree-0001', TREE2: 'https://example.com/fixt/tree-0002',
  TREE3: 'https://example.com/fixt/tree-0003', TREE4: 'https://example.com/fixt/tree-0004',
  TREE5: 'MARK-T5',
  PG1: 'PDFQR-FIXTURE-PAGE-1', PG2: 'PDFQR-FIXTURE-PAGE-2',
  EAN13: '4006381333931', EAN13_ADDON: '53', EAN13_B: '5901234123457',
  C128: 'Code128-FIXTURE', UPCA: '012345678905', ITF14: '12345678901231',
  PDF417: 'PDF417-FIXTURE', AZTEC: 'Aztec-FIXTURE', DM: 'DataMatrix-FIXTURE',
  GS1: '(01)12345678901231(17)261231(10)LOT42',
  TEL_A: 'Hello Telepen', TEL_N: '1234567890',
  BIN: [0x41, 0x42, 0xff, 0xfe, 0x80, 0x00, 0x01],
  MICRO: 'MICRO-123', RMQR: 'rMQR-FIXTURE', INV: 'https://example.com/fixt/inverted',
  OCCL: 'OCCLUSION-TEST',
};

const rel = (...p) => path.join(C, ...p);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString();
const bufOf = c => c.toBuffer('image/png');

// ---- QR via the repo's own dev tooling (qrcode lib) ----
async function qrCanvas(text, { scale = 8, margin = 4, ec = 'M', dark = '#000000' } = {}) {
  const c = createCanvas(1, 1);
  await QRCode.toCanvas(c, text, { scale, margin, errorCorrectionLevel: ec, color: { dark, light: '#ffffff' } });
  return c;
}

// ---- barcodes via zxing-wasm's writer (full build) ----
async function zxCanvas(text, wopts, pad = 30) {
  const r = await zxingFull.writeBarcode(text, { scale: 4, addQuietZones: true, ...wopts });
  if (r.error) throw new Error(`${wopts.format}: ${r.error}`);
  const img = await loadImage(Buffer.from(await r.image.arrayBuffer()));
  const c = createCanvas(img.width + 2 * pad, img.height + 2 * pad);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(img, pad, pad);
  return c;
}

// ---- pseudo-photo painter: gradient sky, sun, hills, grain ----
function paintScene(W, H, { seed = 1, grain = 14 } = {}) {
  const c = createCanvas(W, H); const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, '#7fb2d9'); sky.addColorStop(0.6, '#d8e6ef'); sky.addColorStop(1, '#e8ddc8');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  x.fillStyle = '#f7e9b0'; x.beginPath(); x.arc(W * 0.72, H * 0.18, Math.min(W, H) * 0.07, 0, Math.PI * 2); x.fill();
  for (const [yBase, amp, color, phase] of [[0.62, 0.05, '#7a9d6b', seed], [0.72, 0.04, '#5f8452', seed + 2], [0.84, 0.03, '#47663d', seed + 4]]) {
    x.beginPath(); x.moveTo(0, H);
    for (let px = 0; px <= W; px += Math.max(8, W / 200))
      x.lineTo(px, H * yBase + Math.sin(px / (W / (3 + phase)) + phase) * H * amp);
    x.lineTo(W, H); x.closePath(); x.fillStyle = color; x.fill();
  }
  if (grain > 0) { // subtle photographic grain
    const id = x.getImageData(0, 0, W, H); const d = id.data;
    let s = seed * 7919;
    for (let i = 0; i < d.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = ((s >> 16) % (2 * grain)) - grain;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(id, 0, 0);
  }
  return c;
}

function paste(c, img, dx, dy, dw, dh) { c.getContext('2d').drawImage(img, dx, dy, dw, dh); return c; }

const manifest = [];
function entry(e) { manifest.push(e); return e; }

// ============================ A. same payload, many containers ============================
{
  const qr = await qrCanvas(P.A);
  writeFileSync(rel('qr-same-payload', 'qr.png'), bufOf(qr));
  const src = rel('qr-same-payload', 'qr.png');
  run('magick', [src, '-quality', '92', rel('qr-same-payload', 'qr.jpg')]);
  run('magick', [src, '-quality', '90', rel('qr-same-payload', 'qr.webp')]);
  run('magick', [src, rel('qr-same-payload', 'qr.gif')]);
  run('magick', [src, '-define', 'bmp:format=bmp3', rel('qr-same-payload', 'qr.bmp')]);
  run('ffmpeg', ['-y', '-i', src, '-c:v', 'libaom-av1', '-still-picture', '1', '-pix_fmt', 'yuv420p', '-quality', '90', rel('qr-same-payload', 'qr.avif')]);
  writeFileSync(rel('qr-same-payload', 'qr.svg'), await QRCode.toString(P.A, { type: 'svg', margin: 4, errorCorrectionLevel: 'M' }));
  // transparent-background variant: white modules made alpha-0 (documents the flatten-on-white gotcha)
  const t = createCanvas(qr.width, qr.height); const tx = t.getContext('2d');
  tx.drawImage(qr, 0, 0);
  const id = tx.getImageData(0, 0, t.width, t.height); const d = id.data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) d[i + 3] = 0;
  tx.putImageData(id, 0, 0);
  writeFileSync(rel('qr-same-payload', 'qr-transparent.png'), bufOf(t));
  entry({ id: 'same-payload', dir: 'qr-same-payload', kind: 'raster', container: 'PNG,JPEG,WebP,GIF,BMP,AVIF,SVG(+transparent PNG)', payload: P.A, symbology: 'QRCode', expected: { defaultQR: 1, allFormats: 1 }, notes: 'Identical payload across 8 containers. qr-transparent.png decodes to 0 codes as raw RGBA; 1 code after alpha is flattened on white (#20 measured).' });
}

// ============================ B. EXIF orientation 6 / 8 ============================
{
  const scene = paintScene(1500, 2000, { seed: 3 });           // upright portrait
  const qr = await qrCanvas(P.A, { scale: 10 });
  paste(scene, qr, 1500 - 460, 2000 - 460, 310, 310);
  const mk = (dir, cw) => { // cw=true: stored pixels are upright rotated 90° CW (display needs CCW => EXIF 8)
    const r = createCanvas(2000, 1500); const x = r.getContext('2d');
    x.translate(2000 / 2, 1500 / 2); x.rotate((cw ? -1 : 1) * Math.PI / 2); x.drawImage(scene, -1500 / 2, -2000 / 2);
    const f = rel('orientation', dir); writeFileSync(f, r.toBuffer('image/jpeg', { quality: 0.9 }));
    run('exiftool', ['-overwrite_original', '-EXIF:Orientation=' + (cw ? 8 : 6), '-n', f]);
  };
  mk('exif-orientation-6.jpg', false); mk('exif-orientation-8.jpg', true);
  entry({ id: 'exif-orientation', dir: 'orientation', kind: 'raster', container: 'JPEG', payload: P.A, symbology: 'QRCode', width: 2000, height: 1500, expected: { defaultQR: 1, allFormats: 1 }, notes: 'Stored pixels are the upright scene rotated by metadata only: orientation-6 stored = upright rotated 90° CCW; orientation-8 stored = upright rotated 90° CW. createImageBitmap applies EXIF by default (#20); the stb Blob path ignores EXIF (harmless for 2D).' });
}

// ============================ C. large photos + decompression-bomb guard ============================
async function largePhoto(name, W, H, scale, quality) {
  const scene = paintScene(W, H, { seed: 5, grain: 10 });
  const qr = await qrCanvas(P.A, { scale });
  paste(scene, qr, W - qr.width - Math.round(W * 0.03), Math.round(H * 0.03), qr.width, qr.height);
  const f = rel('large', name);
  writeFileSync(f, scene.toBuffer('image/jpeg', { quality }));
  return { f, w: W, h: H, qrPx: qr.width };
}
{
  const a = await largePhoto('photo-12mp-qr-corner.jpg', 4032, 3024, 14, 0.85);   // 12.2 MP, fits every known canvas cap
  entry({ id: 'large-12mp', dir: 'large', kind: 'raster', container: 'JPEG', payload: P.A, symbology: 'QRCode', width: 4032, height: 3024, expected: { defaultQR: 1, allFormats: 1 }, notes: `12 MP photo, QR top-right (~${a.qrPx}px). Fits the old 4096² iOS canvas cap.` });
  const b = await largePhoto('photo-48mp-qr-corner.jpg', 8000, 6000, 20, 0.82);   // 48 MP, fits 8192²+ area caps only
  entry({ id: 'large-48mp', dir: 'large', kind: 'raster', container: 'JPEG', payload: P.A, symbology: 'QRCode', width: 8000, height: 6000, expected: { defaultQR: 1, allFormats: 1 }, notes: '48 MP photo, QR top-right. Over the 4096² iOS canvas cap; fits 8192². Feeds the pixel-budget / oversize policy (fog: "Pixel-budget values").' });
  const bomb = createCanvas(12000, 12000); const bx = bomb.getContext('2d');
  bx.fillStyle = '#ffffff'; bx.fillRect(0, 0, 12000, 12000);
  const qr = await qrCanvas(P.A, { scale: 12 });
  paste(bomb, qr, 12000 - qr.width - 100, 100, qr.width, qr.height);
  writeFileSync(rel('large', 'bomb-144mp.png'), bufOf(bomb));
  entry({ id: 'bomb-144mp', dir: 'large', kind: 'raster', container: 'PNG', payload: P.A, symbology: 'QRCode', width: 12000, height: 12000, expected: { defaultQR: 1, allFormats: 1 }, notes: '144 MP "decompression bomb": 12000² is accepted by Chromium and Firefox (#20 measured; 20000² is too) and zxing still finds the corner QR via tryDownscale in Node — but it busts every device pixel budget and the iOS canvas caps. The oversize-rejection policy test case (fog: "Pixel-budget values and oversize policy").' });
}

// ============================ D. quality stressors ============================
{
  const lc = await qrCanvas(P.A, { scale: 8, dark: '#9a9a9a' });
  writeFileSync(rel('quality', 'qr-low-contrast.jpg'), lc.toBuffer('image/jpeg', { quality: 0.95 }));
  const sk = createCanvas(520, 520); const sx = sk.getContext('2d');
  sx.fillStyle = '#fff'; sx.fillRect(0, 0, 520, 520);
  const qrc = await qrCanvas(P.A, { scale: 5 });
  sx.setTransform(1, 0.28, -0.22, 1, 120, 60); sx.drawImage(qrc, 0, 0); sx.setTransform(1, 0, 0, 1, 0, 0);
  writeFileSync(rel('quality', 'qr-skewed.png'), bufOf(sk));
  const ocq = await qrCanvas(P.OCCL, { scale: 8, ec: 'H' });
  const oc = createCanvas(ocq.width, ocq.height); const ox = oc.getContext('2d');
  ox.fillStyle = '#fff'; ox.fillRect(0, 0, oc.width, oc.height); ox.drawImage(ocq, 0, 0);
  ox.fillStyle = '#b8b8b8'; ox.fillRect(oc.width * 0.35, oc.height * 0.35, oc.width * 0.30, oc.height * 0.20); // ~18% area, clear of all finder corners
  ox.fillStyle = '#555'; ox.font = 'bold 40px sans-serif'; ox.fillText('STICKER', oc.width * 0.38, oc.height * 0.48);
  writeFileSync(rel('quality', 'qr-occluded.png'), bufOf(oc));
  const qr2 = await qrCanvas(P.A, { scale: 6 });
  const rot = createCanvas(qr2.height, qr2.width); const rx = rot.getContext('2d');
  rx.translate(rot.width / 2, rot.height / 2); rx.rotate(Math.PI / 2); rx.drawImage(qr2, -qr2.width / 2, -qr2.height / 2);
  writeFileSync(rel('quality', 'qr-baked-rot90.png'), bufOf(rot));
  entry({ id: 'quality', dir: 'quality', kind: 'raster', container: 'JPEG,PNG', payloads: [{ symbology: 'QRCode', data: P.A }, { symbology: 'QRCode', data: P.OCCL }], expected: { defaultQR: 1, allFormats: 1, note: 'all four decode with zxing defaults on 3.1.6: low-contrast (26% luminance delta) still reads, skewed relies on tryDownscale, occluded has ~18% of the symbol covered in a centre band clear of the finder patterns, baked-rot90 relies on tryRotate' }, notes: 'Low-contrast (26% luminance delta), ~25° skewed with shear, centre sticker occlusion over an EC-H symbol, and a QR whose pixels are rotated 90° with no EXIF. Borderline cases that document how far the default reader options go.' });
}

// ============================ E. symbology samples ============================
{
  const specs = [
    ['ean13.png', P.EAN13, { format: 'EAN13' }],
    ['code128.png', P.C128, { format: 'Code128' }],
    ['datamatrix.png', P.DM, { format: 'DataMatrix', scale: 8 }],
    ['pdf417.png', P.PDF417, { format: 'PDF417' }],
    ['aztec.png', P.AZTEC, { format: 'Aztec', scale: 8 }],
    ['upca.png', P.UPCA, { format: 'UPCA' }],
    ['itf14.png', P.ITF14, { format: 'ITF14' }],
    ['ean13-addon5.png', `${P.EAN13}+${P.EAN13_ADDON}`, { format: 'EAN13' }],
    ['gs1-code128.png', P.GS1, { format: 'Code128', options: 'gs1' }],
    ['gs1-datamatrix.png', P.GS1, { format: 'DataMatrix', options: 'gs1', scale: 8 }],
    ['telepen-alpha.png', P.TEL_A, { format: 'Telepen' }],
    ['telepen-numeric.png', P.TEL_N, { format: 'TelepenNumeric' }],
    ['qr-binary.png', new Uint8Array(P.BIN), { format: 'QRCode', scale: 8 }],
    ['qr-256bytes.png', Uint8Array.from({ length: 256 }, (_, i) => i), { format: 'QRCode', scale: 8, ecLevel: 'M' }],
    ['qr-micro.png', P.MICRO, { format: 'MicroQRCode', scale: 8 }],
    ['qr-rmqr.png', P.RMQR, { format: 'RMQRCode', scale: 8 }],
    ['qr-inverted.png', P.INV, { format: 'QRCode', scale: 8, invert: true }],
  ];
  for (const [name, input, wopts] of specs) {
    const c = await zxCanvas(input, wopts);
    writeFileSync(rel('symbologies', name), bufOf(c));
  }
  entry({ id: 'symbologies', dir: 'symbologies', kind: 'raster', container: 'PNG', expected: { note: 'Read expectations recorded per file in "samples"; all generated by zxing-wasm 3.1.6 full writer and read-verified below.' }, samples: [
    { file: 'ean13.png', payload: P.EAN13, expected: { allFormats: 1 } },
    { file: 'code128.png', payload: P.C128, expected: { allFormats: 1 } },
    { file: 'datamatrix.png', payload: P.DM, expected: { defaultQR: 0, allFormats: 1 } },
    { file: 'pdf417.png', payload: P.PDF417, expected: { defaultQR: 0, allFormats: 1 } },
    { file: 'aztec.png', payload: P.AZTEC, expected: { defaultQR: 0, allFormats: 1 } },
    { file: 'upca.png', payload: `UPC-A ${P.UPCA}`, expected: { allFormats: 1 }, note: 'UPC-A is reported as EAN13 "0" + text (13 digits) under broad selectors (#23 §2).' },
    { file: 'itf14.png', payload: P.ITF14, expected: { allFormats: 1 }, note: 'ITF-14 is reported as format ITF, text unchanged.' },
    { file: 'ean13-addon5.png', payload: `${P.EAN13} + add-on ${P.EAN13_ADDON}`, expected: { allFormats: 1, addonRead: 2 }, note: 'Add-on is only returned with eanAddOnSymbol:"Read" (default "Ignore" returns the main symbol only) — the unverified case from #23 §10.' },
    { file: 'gs1-code128.png', payload: P.GS1, expected: { allFormats: 1 }, note: 'contentType GS1, symbologyIdentifier ]C1, HRI renders AI in parentheses.' },
    { file: 'gs1-datamatrix.png', payload: P.GS1, expected: { defaultQR: 0, allFormats: 1 }, note: 'contentType GS1, symbologyIdentifier ]d2.' },
    { file: 'telepen-alpha.png', payload: P.TEL_A, expected: { allFormats: 1 } },
    { file: 'telepen-numeric.png', payload: P.TEL_N, expected: { allFormats: 1 }, note: 'KNOWN MISREAD under broad selectors: TelepenNumeric decodes as TelepenAlpha with garbage text; only narrow ["TelepenNumeric"] reads it right (#23 §2).' },
    { file: 'qr-binary.png', payloadBase64: Buffer.from(P.BIN).toString('base64'), expected: { defaultQR: 1, allFormats: 1 }, note: 'Non-UTF-8 binary QR (ECI 899 from the writer); text is HRI-escaped, bytes are exact.' },
    { file: 'qr-256bytes.png', payloadBase64: Buffer.from(Uint8Array.from({ length: 256 }, (_, i) => i)).toString('base64'), expected: { defaultQR: 1, allFormats: 1 }, note: 'All 256 byte values; contentType Binary.' },
    { file: 'qr-micro.png', payload: P.MICRO, expected: { defaultQR: 1, allFormats: 1 }, note: 'MicroQRCode is inside the ["QRCode"] symbology root (#23 §3).' },
    { file: 'qr-rmqr.png', payload: P.RMQR, expected: { defaultQR: 1, allFormats: 1 }, note: 'rMQRCode is inside the ["QRCode"] symbology root.' },
    { file: 'qr-inverted.png', payload: P.INV, expected: { defaultQR: 1, allFormats: 1 }, note: 'White-on-black; found with tryInvert (default true).' },
  ] });
  // mixed symbologies, one image
  const cells = [
    ['QR', await qrCanvas(P.A, { scale: 6 })],
    ['DM', await zxCanvas(P.DM, { format: 'DataMatrix', scale: 7 }, 20)],
    ['C128', await zxCanvas(P.C128, { format: 'Code128' }, 20)],
    ['EAN', await zxCanvas(P.EAN13_B, { format: 'EAN13' }, 20)],
    ['PDF417', await zxCanvas(P.PDF417, { format: 'PDF417' }, 20)],
    ['Aztec', await zxCanvas(P.AZTEC, { format: 'Aztec', scale: 7 }, 20)],
    ['UPCA', await zxCanvas(P.UPCA, { format: 'UPCA' }, 20)],
    ['ITF14', await zxCanvas(P.ITF14, { format: 'ITF14' }, 20)],
  ];
  const cw = Math.max(...cells.map(([, c]) => c.width)) + 40, ch = Math.max(...cells.map(([, c]) => c.height)) + 40;
  const grid = createCanvas(cw * 2, ch * 4); const gx = grid.getContext('2d');
  gx.fillStyle = '#fff'; gx.fillRect(0, 0, grid.width, grid.height);
  cells.forEach(([label, c], i) => gx.drawImage(c, (i % 2) * cw + 20, Math.floor(i / 2) * ch + 20));
  writeFileSync(rel('symbologies', 'mixed-symbologies.png'), bufOf(grid));
  entry({ id: 'mixed-symbologies', dir: 'symbologies', kind: 'raster', container: 'PNG', expected: { defaultQR: 1, allFormats: 8 }, payloads: [P.A, P.DM, P.C128, P.EAN13_B, P.PDF417, P.AZTEC, `UPC-A as EAN13: 0${P.UPCA}`, P.ITF14], notes: 'Eight symbols in one image: QR, DataMatrix, Code128, EAN-13, PDF417, Aztec, UPC-A (reads as EAN13), ITF-14 (reads as ITF).' });
}

// ============================ F. customer cards (PDF) ============================
async function card(name, { withStrip }) {
  const pdf = new PDFDocument({ size: 'A4', margin: 0, info: { Title: name } });
  const bufs = []; pdf.on('data', b => bufs.push(b));
  const done = new Promise(res => pdf.on('end', res));
  const W = 595.28, H = 841.89;
  pdf.rect(0, 0, W, 120).fill('#1a2b4a');
  pdf.fill('#fff').font('Helvetica-Bold').fontSize(26).text('ACME CUSTOMER CARD', 40, 46);
  pdf.fontSize(10).text('Property of ACME GmbH — sample fixture', 40, 84);
  pdf.fill('#111').font('Helvetica').fontSize(12);
  const lines = ['Name:  Erika Musterfrau', 'ID:    ACME-0042', 'Since: 2026-10-27', 'Plan:  Business'];
  lines.forEach((l, i) => pdf.text(l, 40, 170 + i * 22));
  for (let i = 0; i < 16; i++) pdf.fontSize(8).fillOpacity(0.6).text('Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.', 40, 300 + i * 14, { lineBreak: false });
  pdf.fillOpacity(1);
  const qr = await zxCanvas(P.CUST_URL, { format: 'QRCode', scale: 8 }, 12);
  pdf.image(await pdfImg(qr), 380, 170, { width: 160 });
  const dmA = await zxCanvas(P.MARK_A, { format: 'DataMatrix', scale: 5 }, 8);
  const dmB = await zxCanvas(P.MARK_B, { format: 'DataMatrix', scale: 5 }, 8);
  pdf.image(await pdfImg(dmA), 30, 26, { width: 44 });   // top-left
  pdf.image(await pdfImg(dmB), W - 74, 26, { width: 44 }); // top-right
  pdf.image(await pdfImg(dmA), 30, H - 74, { width: 44 }); // bottom-left
  pdf.image(await pdfImg(dmB), W - 74, H - 74, { width: 44 }); // bottom-right
  if (withStrip) {
    const c128 = await zxCanvas(P.CUST_NO, { format: 'Code128', scale: 3, addHRT: true }, 10);
    pdf.image(await pdfImg(c128), 120, 640, { width: 350 });
  }
  pdf.end();
  await done;
  const f = rel('cards', name); writeFileSync(f, Buffer.concat(bufs));
  return f;
}
// pdfkit needs Uint8Array/Buffer for images — canvas toBuffer is already a Buffer
const pdfImg = async c => bufOf(c);

{
  const f1 = await card('customer-card-datamatrix.pdf', { withStrip: false });
  const f2 = await card('customer-card-1d.pdf', { withStrip: true });
  entry({ id: 'customer-card-dm', dir: 'cards', kind: 'pdf', file: 'customer-card-datamatrix.pdf', expected: { defaultQR: 1, allFormats: 5 }, payloads: [P.CUST_URL, P.MARK_A, P.MARK_B], notes: 'Real-style customer card: QR (customer URL) + 4 corner DataMatrix marks (2 distinct payloads, each twice). Default ["QRCode"] must return only the QR; all formats additionally return 4 DataMatrix reads (#23 §5).' });
  entry({ id: 'customer-card-1d', dir: 'cards', kind: 'pdf', file: 'customer-card-1d.pdf', expected: { defaultQR: 1, allFormats: 6 }, payloads: [P.CUST_URL, P.MARK_A, P.MARK_B, P.CUST_NO], notes: 'Same card plus a Code128 strip (customer number, HRI) — the "1D-strip card" from #23 §10.' });
}

// ============================ G. HEIC + multi-page TIFF ============================
{
  // 12 MP HEIC from the same scene as photo-12mp (pillow-heif via python3)
  const scene = paintScene(4032, 3024, { seed: 5, grain: 10 });
  const qr = await qrCanvas(P.A, { scale: 14 });
  paste(scene, qr, 4032 - qr.width - 120, 90, qr.width, qr.height);
  const sceneJpg = rel('heic-tiff', '.scene-12mp.tmp.jpg');
  writeFileSync(sceneJpg, scene.toBuffer('image/jpeg', { quality: 0.9 }));
  const py = `
import json, sys
from PIL import Image
import pillow_heif
pillow_heif.register_heif_opener()
im = Image.open(sys.argv[1]).convert('RGB')
im.save(sys.argv[2], format='HEIF', quality=85)
print(json.dumps({'pages': 1, 'size': list(im.size)}))
`;
  const out = run('python3', ['-c', py, sceneJpg, rel('heic-tiff', 'photo-12mp.heic')]);
  rmSync(sceneJpg);
  entry({ id: 'heic-12mp', dir: 'heic-tiff', kind: 'heic', file: 'photo-12mp.heic', payload: P.A, symbology: 'QRCode', width: 4032, height: 3024, expected: { defaultQR: 1, allFormats: 1 }, notes: `Single-image HEIC (pillow-heif/x265, q85). Native decode: Safari 17+ only; otherwise lazy libheif-js fallback (#21). python: ${out.trim()}` });

  // multi-page G4 TIFF: the realistic scanned fax/document case (#21 §5)
  const pageSpecs = [
    { payload: P.A, label: 'PAGE 1' }, { payload: P.A, label: 'PAGE 2' }, { payload: P.B, label: 'PAGE 3' },
  ];
  const pageFiles = [];
  for (const [i, p] of pageSpecs.entries()) {
    const qc = await qrCanvas(p.payload, { scale: 10 });
    const f = rel('heic-tiff', `.tiffpage${i}.tmp.png`); writeFileSync(f, bufOf(qc)); pageFiles.push(f);
  }
  const py2 = `
import json, sys
from PIL import Image, ImageDraw
outs = []
for png, label in zip(sys.argv[1:-2], sys.argv[-2].split('|')):
    im = Image.open(png).convert('L')
    page = Image.new('L', (1700, 2200), 255)
    d = ImageDraw.Draw(page)
    d.text((100, 80), label, fill=0)
    page.paste(im, (250, 300))
    page = page.point(lambda v: 0 if v < 128 else 255, mode='1')
    outs.append(page)
outs[0].save(sys.argv[-1], format='TIFF', compression='group4', save_all=True, append_images=outs[1:])
print(json.dumps({'pages': len(outs)}))
`;
  const payloads = pageSpecs.map(p => p.payload).join('|');
  const labels = pageSpecs.map(p => p.label).join('|');
  const out2 = run('python3', ['-c', py2, ...pageFiles, labels, rel('heic-tiff', 'multi-page-g4.tiff')]);
  for (const f of pageFiles) rmSync(f);
  entry({ id: 'tiff-multipage-g4', dir: 'heic-tiff', kind: 'tiff', file: 'multi-page-g4.tiff', payloads: pageSpecs.map(p => p.payload), expected: { pages: 3, note: 'Pages 1+2 carry the same payload A (dedupe/ordering case), page 3 carries B. Each IFD is one scan page (#21: utif2). 1-bit CCITT G4 — the realistic scanned document.' }, notes: `CCITT G4, 1700×2200 1-bit, 3 pages. python: ${out2.trim()}` });
}

// ============================ H. folder tree + ZIP ============================
{
  const T = rel('trees', 'tree-mixed');
  const qrA = await qrCanvas(P.TREE1, { scale: 6 });
  const qrB = await qrCanvas(P.TREE2, { scale: 6 });
  const dmT = await zxCanvas(P.TREE5, { format: 'DataMatrix', scale: 6 }, 16);
  const guard = paintScene(900, 600, { seed: 9, grain: 8 });
  writeFileSync(path.join(T, 'cards', 'card-1.png'), bufOf(qrA));
  writeFileSync(path.join(T, 'cards', 'photo-1.png'), bufOf(guard));
  writeFileSync(path.join(T, 'reports', 'card-1.png'), bufOf(qrB));   // duplicate basename, different payload
  writeFileSync(path.join(T, 'invoices', 'inv-7.png'), bufOf(dmT));
  // 2-page PDF inside the tree
  const pdf = new PDFDocument({ size: 'A4', margin: 40 });
  const bufs = []; pdf.on('data', b => bufs.push(b));
  const done = new Promise(res => pdf.on('end', res));
  const q1 = await qrCanvas(P.TREE3, { scale: 7 }); const q2 = await qrCanvas(P.TREE4, { scale: 7 });
  pdf.fontSize(14).text('Scan batch document — page 1', 60, 80); pdf.image(bufOf(q1), 200, 300, { width: 200 });
  pdf.addPage().fontSize(14).text('Scan batch document — page 2', 60, 80); pdf.image(bufOf(q2), 200, 300, { width: 200 });
  pdf.end(); await done;
  writeFileSync(path.join(T, 'docs', 'scan.pdf'), Buffer.concat(bufs));
  const zipFrom = rel('trees');
  run('zip', ['-r', 'tree-mixed.zip', 'tree-mixed'], { cwd: zipFrom });
  entry({ id: 'tree-mixed', dir: 'trees', kind: 'tree+zip', files: ['tree-mixed/cards/card-1.png', 'tree-mixed/cards/photo-1.png', 'tree-mixed/reports/card-1.png', 'tree-mixed/docs/scan.pdf', 'tree-mixed/invoices/inv-7.png'], payloads: { 'tree-mixed/cards/card-1.png': P.TREE1, 'tree-mixed/reports/card-1.png': P.TREE2, 'tree-mixed/docs/scan.pdf': [P.TREE3, P.TREE4], 'tree-mixed/invoices/inv-7.png': P.TREE5 }, expected: { note: 'cards/photo-1.png is a no-code guard.' }, notes: 'Mixed folder tree, also zipped as tree-mixed.zip. card-1.png exists in two subfolders with different payloads (duplicate basename case); PDF inside the tree has two pages with distinct payloads.' });
}

// ============================ I. PDF baseline ============================
{
  const REPO = '/home/jonas/dev/PDF-QR-Scanner';
  copyFileSync(path.join(REPO, 'fixtures', 'example.pdf'), rel('pdf', 'example.pdf'));
  const pdf = new PDFDocument({ size: 'A4', margin: 40 });
  const bufs = []; pdf.on('data', b => bufs.push(b));
  const done = new Promise(res => pdf.on('end', res));
  const q1 = await qrCanvas(P.PG1, { scale: 7 }); const q2 = await qrCanvas(P.PG2, { scale: 7 });
  pdf.fontSize(13).text('Two-page fixture: distinct payload per page (page,qr-code CSV rows).', 60, 70);
  pdf.image(bufOf(q1), 200, 300, { width: 200 });
  pdf.addPage().text('Page 2', 60, 70); pdf.image(bufOf(q2), 200, 300, { width: 200 });
  pdf.end(); await done;
  writeFileSync(rel('pdf', 'two-page-qr.pdf'), Buffer.concat(bufs));
  entry({ id: 'pdf-baseline', dir: 'pdf', kind: 'pdf', files: ['example.pdf', 'two-page-qr.pdf'], payloads: { 'example.pdf': 'https://github.com/tsueri/PDF-QR-Scanner', 'two-page-qr.pdf': [P.PG1, P.PG2] }, notes: 'example.pdf copied byte-identical from the repo (10°-tilted vector QR, payload https://github.com/tsueri/PDF-QR-Scanner) — the baseline for the existing page,qr-code CSV. two-page-qr.pdf has one distinct payload per page for CSV row checks.' });
}

// ============================ J. false-positive guards ============================
{
  const g = paintScene(1200, 800, { seed: 11, grain: 20 });
  writeFileSync(rel('guards', 'gradient-photo.png'), bufOf(g));
  const tp = createCanvas(1191, 1684); const tx = tp.getContext('2d');
  tx.fillStyle = '#fff'; tx.fillRect(0, 0, 1191, 1684); tx.fillStyle = '#222';
  let s = 42;
  for (let row = 0; row < 40; row++) {
    let line = '';
    for (let w = 0; w < 14; w++) { s = (s * 1103515245 + 12345) & 0x7fffffff; line += ['lorem ', 'ipsum ', 'dolor ', 'sit ', 'amet '][(s >> 12) % 5]; }
    tx.font = '13px sans-serif'; tx.fillText(line, 60, 80 + row * 38);
  }
  tx.strokeStyle = '#888'; tx.strokeRect(60, 40, 1071, 1600);
  writeFileSync(rel('guards', 'text-page.png'), bufOf(tp));
  const nz = createCanvas(800, 600); const nx = nz.getContext('2d');
  const id = nx.createImageData(800, 600); s = 7;
  for (let i = 0; i < id.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; id.data[i] = s & 255; s = (s * 1103515245 + 12345) & 0x7fffffff; id.data[i + 1] = s & 255; s = (s * 1103515245 + 12345) & 0x7fffffff; id.data[i + 2] = s & 255; id.data[i + 3] = 255; }
  nx.putImageData(id, 0, 0);
  writeFileSync(rel('guards', 'noise.png'), bufOf(nz));
  const fw = createCanvas(400, 300); fw.getContext('2d').fillStyle = '#fff'; fw.getContext('2d').fillRect(0, 0, 400, 300);
  writeFileSync(rel('guards', 'flat-white.png'), bufOf(fw));
  entry({ id: 'guards', dir: 'guards', kind: 'raster', container: 'PNG', expected: { defaultQR: 0, allFormats: 0 }, notes: 'Non-barcode false-positive guard set: gradient photo, dense text page, random RGB noise, flat white. #23 measured 0 valid false positives on 303 similar images with returnErrors off.' });
}

writeFileSync(rel('manifest.expected.json'), JSON.stringify({ generatedWith: { 'zxing-wasm': '3.1.6', note: 'writer = zxing-wasm full build; reader verification in verify.mjs' }, entries: manifest }, null, 2));
console.log(`OK: ${manifest.length} manifest entries written to corpus/manifest.expected.json`);