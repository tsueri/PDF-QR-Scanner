import { readFileSync, writeFileSync, copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

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
  'app.js',
  'csv.js',
  'zip.js',
  'scan.worker.js',
  'scss/custom.css',
  '.htaccess',
  'LICENSE',
  'llms.txt',
];

for (const f of staticFiles) {
  const destPath = resolve(releaseDir, f);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(resolve(root, f), destPath);
}

// scan.js with patched paths
let scanJs = readFileSync(resolve(root, 'scan.js'), 'utf8');
scanJs = scanJs.replace(
  "'./node_modules/pdfjs-dist/build/pdf.worker.mjs'",
  "'./vendor/pdf.worker.mjs'"
);
scanJs = scanJs.replace(
  "'./node_modules/jsqr/dist/jsQR.js'",
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
writeFileSync(resolve(releaseDir, 'index.html'), indexHtml);

// --------------- zip ---------------

const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const zipName = `pdf-qr-scanner-v${version}.zip`;
const zipPath = resolve(root, zipName);

if (process.platform === 'linux' || process.platform === 'darwin') {
  execSync(`zip -r "${zipPath}" .`, { cwd: releaseDir, stdio: 'inherit' });
} else {
  execSync(`powershell -Command "Compress-Archive -Path '${releaseDir}\\*' -DestinationPath '${zipPath}'"`, { stdio: 'inherit' });
}

console.log(`\nRelease zip created: ${zipName}`);
