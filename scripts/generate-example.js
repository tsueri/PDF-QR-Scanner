// Generates example.pdf: a single-page PDF with a vector-based QR code tilted by 10°
// Uses vector rectangles (not raster images) so it renders correctly in all environments.
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const TEST_DATA = 'https://github.com/tsueri/PDF-QR-Scanner';
const TILT_DEG = 10;
const MODULE_PT = 8; // size of each QR module in PDF points
const MARGIN_MODULES = 2;

async function main() {
  const qrData = QRCode.create(TEST_DATA, { errorCorrectionLevel: 'M' });
  const size = qrData.modules.size;
  const totalModules = size + MARGIN_MODULES * 2;
  const qrPtSize = totalModules * MODULE_PT;

  const rad = (TILT_DEG * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  const doc = new PDFDocument({ size: 'A4' });
  const stream = fs.createWriteStream('example.pdf');
  doc.pipe(stream);

  // Center the rotated QR code on the page so it doesn't clip
  const half = qrPtSize / 2;
  const corners = [
    { x: -half, y: -half },
    { x:  half, y: -half },
    { x:  half, y:  half },
    { x: -half, y:  half },
  ];
  const rotated = corners.map(p => ({
    x: p.x * cosR - p.y * sinR,
    y: p.x * sinR + p.y * cosR,
  }));
  const minX = Math.min(...rotated.map(p => p.x));
  const maxX = Math.max(...rotated.map(p => p.x));
  const minY = Math.min(...rotated.map(p => p.y));
  const maxY = Math.max(...rotated.map(p => p.y));
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  const originX = (doc.page.width - bboxW) / 2 - minX;
  const originY = (doc.page.height - bboxH) / 2 - minY;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!qrData.modules.get(row, col)) continue;

      const sx = (col + MARGIN_MODULES) * MODULE_PT - half;
      const sy = (row + MARGIN_MODULES) * MODULE_PT - half;

      const rx = sx * cosR - sy * sinR + originX;
      const ry = sx * sinR + sy * cosR + originY;

      doc.rect(rx, ry, MODULE_PT, MODULE_PT);
    }
  }

  doc.fill('black');
  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      console.log(`Created example.pdf: ${TEST_DATA} tilted ${TILT_DEG}° (${size}x${size} QR, ${MODULE_PT}pt modules)`);
      resolve();
    });
    stream.on('error', reject);
  });
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
