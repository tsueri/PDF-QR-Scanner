import { readFileSync, writeFileSync, copyFileSync, cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const releaseDir = resolve(root, 'release');
const vendorDir = resolve(releaseDir, 'vendor');

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(vendorDir, { recursive: true });

// --------------- vendor files ---------------

const vendorFiles = [
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'vendor/pdf.mjs'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'vendor/pdf.worker.mjs'],
  ['node_modules/jsqr/dist/jsQR.js', 'vendor/jsQR.js'],
  ['node_modules/jszip/dist/jszip.min.js', 'vendor/jszip.min.js'],
];

for (const [src, dst] of vendorFiles) {
  const destPath = resolve(releaseDir, dst);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(resolve(root, src), destPath);
}

cpSync(resolve(root, 'node_modules/pdfjs-dist/cmaps'), resolve(vendorDir, 'cmaps'), { recursive: true });
cpSync(resolve(root, 'node_modules/pdfjs-dist/standard_fonts'), resolve(vendorDir, 'standard_fonts'), { recursive: true });

// --------------- source files ---------------

const staticFiles = [
  ['src/app.js', 'app.js'],
  ['src/csv.js', 'csv.js'],
  ['src/zip.js', 'zip.js'],
  ['src/scan.worker.js', 'scan.worker.js'],
  ['src/scss/custom.css', 'scss/custom.css'],
  ['LICENSE', 'LICENSE'],
  ['llms.txt', 'llms.txt'],
];

for (const [src, dst] of staticFiles) {
  const destPath = resolve(releaseDir, dst);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(resolve(root, src), destPath);
}

// scan.js with patched paths
let scanJs = readFileSync(resolve(root, 'src/scan.js'), 'utf8');
scanJs = scanJs.replace(
  "'../node_modules/pdfjs-dist/build/pdf.worker.mjs'",
  "'./vendor/pdf.worker.mjs'"
);
scanJs = scanJs.replace(
  "'../node_modules/jsqr/dist/jsQR.js'",
  "'./vendor/jsQR.js'"
);
writeFileSync(resolve(releaseDir, 'scan.js'), scanJs);

// index.html with patched paths
let indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
indexHtml = indexHtml.replace(
  '"./node_modules/pdfjs-dist/build/pdf.mjs"',
  '"./vendor/pdf.mjs"'
);
indexHtml = indexHtml.replace(
  '"node_modules/jsqr/dist/jsQR.js"',
  '"vendor/jsQR.js"'
);
indexHtml = indexHtml.replace(
  '"node_modules/jszip/dist/jszip.min.js"',
  '"vendor/jszip.min.js"'
);
indexHtml = indexHtml.replace(
  'src="src/app.js"',
  'src="app.js"'
);
indexHtml = indexHtml.replace(
  'href="src/scss/custom.css"',
  'href="scss/custom.css"'
);
writeFileSync(resolve(releaseDir, 'index.html'), indexHtml);

// --------------- zip ---------------

function addDir(zip, dir, base) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    const archivePath = relative(base, fullPath);
    if (entry.isDirectory()) {
      addDir(zip, fullPath, base);
    } else {
      zip.file(archivePath, readFileSync(fullPath));
    }
  }
}

const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const zipName = `pdf-qr-scanner-v${version}.zip`;
const zipPath = resolve(root, zipName);

const zip = new JSZip();
addDir(zip, releaseDir, releaseDir);
const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
writeFileSync(zipPath, zipBuf);

console.log(`\nRelease zip created: ${zipName}`);
