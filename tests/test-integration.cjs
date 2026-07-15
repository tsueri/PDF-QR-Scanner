// Puppeteer integration test: full batch flow from file selection through ZIP download.
// Run: npm run test:integration   or   node test-integration.cjs
//
// Uses existing devDependencies (puppeteer, qrcode, pdfkit, canvas) to create
// synthetic PDFs with QR codes, feeds them to the app, runs a scan, and verifies
// ZIP contents and UI state.

const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const JSZip = require('jszip');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = 9091;
const TMP_DIR = path.join(__dirname, '.tmp-integration');
const PDF_DIR = path.join(TMP_DIR, 'pdfs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('PASS:', message);
  } else {
    failed++;
    console.log('FAIL:', message);
  }
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

async function qrPngBuffer(data, size) {
  return QRCode.toBuffer(String(data), { type: 'png', width: size, margin: 1 });
}

function writePDF(pages, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    pages.forEach(function (pg, idx) {
      if (idx > 0) doc.addPage();
      if (pg.image) {
        const imgW = Math.min(pg.image.width || 200, 400);
        const x = (doc.page.width - imgW) / 2;
        const y = (doc.page.height - imgW) / 2;
        doc.image(pg.image.buffer, x, y, { width: imgW });
      }
      if (pg.text) {
        doc.fontSize(14).text(pg.text, 50, 50);
      }
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function genSyntheticPDFs() {
  fs.mkdirSync(PDF_DIR, { recursive: true });

  const qrHello = await qrPngBuffer('hello', 260);
  const qrWorld = await qrPngBuffer('world', 260);
  const qrDataB = await qrPngBuffer('data-from-b', 260);

  const files = {};

  // file-a.pdf — 2 pages, each with a different QR code
  files.fileA = path.join(PDF_DIR, 'qr-file-a.pdf');
  await writePDF(
    [
      { image: { buffer: qrHello, width: 260 }, text: 'Page 1' },
      { image: { buffer: qrWorld, width: 260 }, text: 'Page 2' },
    ],
    files.fileA
  );

  // file-b.pdf — 1 page, one QR code
  files.fileB = path.join(PDF_DIR, 'qr-file-b.pdf');
  await writePDF(
    [{ image: { buffer: qrDataB, width: 260 }, text: 'Page 1' }],
    files.fileB
  );

  // empty.pdf — 1 page, no QR
  files.empty = path.join(PDF_DIR, 'empty-file.pdf');
  await writePDF(
    [{ text: 'This file has no QR codes at all.' }],
    files.empty
  );

  console.log('Generated synthetic PDFs in', PDF_DIR);
  return files;
}

// ---------------------------------------------------------------------------
// Static HTTP server
// ---------------------------------------------------------------------------

function startServer(port) {
  const root = __dirname;
  const mimeMap = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  const server = http.createServer(function (req, res) {
    let reqPath = new URL(req.url, 'http://localhost').pathname;
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(root, reqPath);

    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeMap[ext] || 'application/octet-stream';

    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      });
      res.end(data);
    });
  });

  return new Promise(function (resolve) {
    server.listen(port, function () {
      console.log('HTTP server listening on port', port);
      resolve(server);
    });
  });
}

// ---------------------------------------------------------------------------
// Zip verification
// ---------------------------------------------------------------------------

async function verifyZipContents(zipPath, expectedEntries, label) {
  try {
    const buf = fs.readFileSync(zipPath);
    const loaded = await JSZip.loadAsync(buf);
    const actualNames = Object.keys(loaded.files).sort();
    const expectedSorted = expectedEntries.map(function (e) { return e.name; }).sort();

    const match =
      actualNames.length === expectedSorted.length &&
      actualNames.every(function (n, i) { return n === expectedSorted[i]; });

    if (match) {
      passed++;
      console.log('PASS:', label + ' — filenames match');
    } else {
      failed++;
      console.log('FAIL:', label + ' — filenames mismatch');
      console.log('  expected:', JSON.stringify(expectedSorted));
      console.log('  got:', JSON.stringify(actualNames));
    }

    for (var ei = 0; ei < expectedEntries.length; ei++) {
      var e = expectedEntries[ei];
      var file = loaded.file(e.name);
      if (!file) {
        failed++;
        console.log('FAIL:', label + ' — missing entry ' + e.name);
        continue;
      }
      var content = await file.async('string');
      if (content.trim() === e.content.trim()) {
        passed++;
        console.log('PASS:', label + ' — content of ' + e.name + ' matches');
      } else {
        failed++;
        console.log('FAIL:', label + ' — content of ' + e.name + ' mismatch');
        console.log('  expected:', JSON.stringify(e.content.trim()));
        console.log('  got:', JSON.stringify(content.trim()));
      }
    }
  } catch (err) {
    failed++;
    console.log('FAIL:', label + ' — ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// buildZip collision test (direct, since app deduplicates by filename)
// ---------------------------------------------------------------------------

async function testCollisionNaming() {
  const { buildZip } = await import('./zip.js');

  const blob = await buildZip([
    { filename: 'report.pdf', csv: 'page,qr-code\n"1","first"' },
    { filename: 'report.pdf', csv: 'page,qr-code\n"1","second"' },
  ]);
  const buf = await blob.arrayBuffer();
  const loaded = await JSZip.loadAsync(buf);
  const names = Object.keys(loaded.files).sort();
  const expected = ['report.csv', 'report (1).csv'].sort();
  assert(
    names.length === expected.length && names.every(function (n, i) { return n === expected[i]; }),
    'Collision naming: two same-name PDFs produce report.csv and report (1).csv'
  );
}

// ---------------------------------------------------------------------------
// Main integration test
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Integration Test: Batch Flow ===\n');

  // Setup temp directories
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Generate synthetic PDFs
  const pdfs = await genSyntheticPDFs();

  // Start HTTP server
  const server = await startServer(PORT);

  let browser;
  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // Navigate to app
    await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'networkidle0' });

    // --- upload files -------------------------------------------------------
    console.log('\n--- Uploading files ---');
    const fileInput = await page.$('#pdfInput');
    await fileInput.uploadFile(pdfs.fileA, pdfs.fileB, pdfs.empty);

    // Wait for file list to show page counts (not "…")
    await page.waitForFunction(function () {
      var metas = document.querySelectorAll('.file-row__meta');
      if (metas.length < 3) return false;
      return Array.from(metas).every(function (m) { return !m.textContent.includes('\u2026'); });
    }, { timeout: 15000 });

    const fileRows = await page.$$('.file-row');
    assert(fileRows.length === 3, '3 files listed after upload');

    // --- scan all -----------------------------------------------------------
    console.log('\n--- Scanning all files ---');

    await page.click('#scanButton');

    // Wait for scan to complete
    await page.waitForFunction(function () {
      var status = document.getElementById('scanStatus');
      return status && status.textContent.includes('Scan complete');
    }, { timeout: 60000 });

    // --- verify per-file status badges --------------------------------------
    console.log('\n--- Verifying per-file status badges ---');

    var badgeTexts = await page.$$eval('[data-file-status]', function (els) {
      return els.map(function (el) { return el.textContent.trim(); });
    });

    var badgeClasses = await page.$$eval('[data-file-status]', function (els) {
      return els.map(function (el) { return el.className; });
    });

    // Should have: "2 codes found" (file-a), "1 code found" (file-b), "No QR codes" (empty)
    var hasTwoCodes = badgeTexts.some(function (t) { return t === '2 codes found'; });
    var hasOneCode = badgeTexts.some(function (t) { return t === '1 code found'; });
    var hasNoCodes = badgeTexts.some(function (t) { return t === 'No QR codes'; });

    assert(hasTwoCodes, 'Per-file badge shows "2 codes found"');
    assert(hasOneCode, 'Per-file badge shows "1 code found"');
    assert(hasNoCodes, 'Per-file badge shows "No QR codes"');

    var hasDoneClass = badgeClasses.some(function (c) { return c.includes('fstate--done'); });
    var hasEmptyClass = badgeClasses.some(function (c) { return c.includes('fstate--empty'); });
    assert(hasDoneClass, 'Badge has fstate--done class');
    assert(hasEmptyClass, 'Badge has fstate--empty class');

    // --- verify aggregate bar -----------------------------------------------
    console.log('\n--- Verifying aggregate bar ---');

    var batchBarCounter = await page.$eval('#batchBarCounter', function (el) { return el.textContent; });
    var batchBarTotal = await page.$eval('#batchBarTotal', function (el) { return el.textContent; });

    assert(batchBarCounter === '3', 'Aggregate bar counter: 3');
    assert(batchBarTotal === '3', 'Aggregate bar total: 3');

    // --- verify ZIP banner --------------------------------------------------
    console.log('\n--- Verifying ZIP banner ---');

    var zipReadyLabel = await page.$eval('#zipReadyLabel', function (el) { return el.textContent.trim(); });
    var zipBtnDisabled = await page.$eval('#zipReadyBtn', function (el) { return el.disabled; });

    assert(zipReadyLabel.includes('ZIP ready'), 'ZIP banner shows "ZIP ready"');
    assert(zipReadyLabel.includes('2 CSV'), 'ZIP banner mentions "2 CSV"');
    assert(zipReadyLabel.includes('1 empty skipped'), 'ZIP banner mentions skipped empty file');
    assert(!zipBtnDisabled, 'Download ZIP button is enabled');

    // --- download and verify ZIP --------------------------------------------
    console.log('\n--- Downloading ZIP ---');

    // Intercept blob via URL.createObjectURL before clicking download
    await page.evaluate(function () {
      var orig = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        window.__testZipBlob = blob;
        return orig.call(URL, blob);
      };
    });

    await page.click('#zipReadyBtn');

    // Wait for button to indicate download completed
    await page.waitForFunction(function () {
      var btn = document.getElementById('zipReadyBtn');
      return btn && btn.textContent.includes('Downloaded');
    }, { timeout: 10000 });

    // Retrieve captured blob as base64
    var zipBase64 = await page.evaluate(async function () {
      var blob = window.__testZipBlob;
      if (!blob) return null;
      var buf = await blob.arrayBuffer();
      var bytes = new Uint8Array(buf);
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    });

    assert(zipBase64 !== null, 'ZIP blob was captured');

    var zipPath = path.join(TMP_DIR, 'downloaded.zip');
    fs.writeFileSync(zipPath, Buffer.from(zipBase64, 'base64'));

    await verifyZipContents(
      zipPath,
      [
        { name: 'qr-file-a.csv', content: 'page,qr-code\n"1","hello"\n"2","world"' },
        { name: 'qr-file-b.csv', content: 'page,qr-code\n"1","data-from-b"' },
      ],
      'Downloaded ZIP'
    );

    // verify empty file excluded
    var zipBuf = fs.readFileSync(zipPath);
    var zipLoaded = await JSZip.loadAsync(zipBuf);
    var zipNames = Object.keys(zipLoaded.files);
    var hasEmptyCSV = zipNames.some(function (n) { return n.includes('empty-file'); });
    assert(!hasEmptyCSV, 'Empty file is excluded from ZIP');

    // --- collision naming test ----------------------------------------------
    console.log('\n--- Testing collision naming ---');
    await testCollisionNaming();

  } finally {
    if (browser) await browser.close();
    server.close();
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) {}
  }

  // --- results -------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed > 0) {
    console.log('INTEGRATION TESTS FAILED');
    process.exit(1);
  }
  console.log('ALL INTEGRATION TESTS PASSED');
  process.exit(0);
}

main().catch(function (e) {
  console.error('Test error:', e);
  process.exit(2);
});
