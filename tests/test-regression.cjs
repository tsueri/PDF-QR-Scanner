// Regression tests for the QR decoder: rotation tolerance, multi-code pages,
// reading order and deduplication.
// Run: node tests/test-regression.cjs

const { createCanvas } = require('canvas');
const QRCode = require('qrcode');

const TILT_DATA = 'PDF-QR-Scanner-tilt-test';

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

function rotateCanvas(sourceCanvas, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.ceil(w * cos + h * sin);
  const newH = Math.ceil(w * sin + h * cos);

  const rotated = createCanvas(newW, newH);
  const rCtx = rotated.getContext('2d');
  rCtx.imageSmoothingEnabled = false;

  rCtx.translate(newW / 2, newH / 2);
  rCtx.rotate(rad);
  rCtx.drawImage(sourceCanvas, -w / 2, -h / 2);

  return { canvas: rotated, ctx: rCtx, width: newW, height: newH };
}

async function canvasFor(data, size) {
  const canvas = createCanvas(size, size);
  await QRCode.toCanvas(canvas, data, { width: size, margin: 1 });
  return canvas;
}

async function main() {
  const { decodeImageData, orderAndDedupeCodes } = await import('../src/decode.js');

  // --- single QR, upright and tilted -------------------------------------
  const qrCanvas = await canvasFor(TILT_DATA, 300);

  {
    const codes = await decodeImageData(qrCanvas.getContext('2d').getImageData(0, 0, 300, 300));
    assert(codes.map(function (c) { return c.data; }).join('|') === TILT_DATA, 'Upright (0°) QR code');
  }

  for (const tilt of [5, 10, 15, 20, 25, 30, 35, 40]) {
    const tilted = rotateCanvas(qrCanvas, tilt);
    const codes = await decodeImageData(tilted.ctx.getImageData(0, 0, tilted.width, tilted.height));
    assert(codes.map(function (c) { return c.data; }).join('|') === TILT_DATA, `Tilted ${tilt}° QR code`);
  }

  // --- several QR codes on one page --------------------------------------
  {
    const page = createCanvas(900, 640);
    const ctx = page.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);

    const topLeft = await canvasFor('top-left', 220);
    const topRight = await canvasFor('top-right', 180);
    const bottom = await canvasFor('bottom', 220);

    ctx.drawImage(topLeft, 30, 30);
    ctx.drawImage(topRight, 640, 40);
    ctx.drawImage(bottom, 330, 360);

    const codes = await decodeImageData(ctx.getImageData(0, 0, page.width, page.height));
    const ordered = orderAndDedupeCodes(7, codes);

    assert(ordered.length === 3, 'Finds every QR code on a page (3/3)');

    const data = ordered.map(function (c) { return c.data; });
    assert(
      data[0] === 'top-left' && data[1] === 'top-right' && data[2] === 'bottom',
      'Orders codes top-to-bottom, left-to-right'
    );
    assert(
      ordered.every(function (c) {
        return c.page === 7 && c.position && typeof c.position.topLeft.x === 'number';
      }),
      'Per-code records carry page and position'
    );
  }

  // --- exact duplicates within a page are deduped ------------------------
  {
    const codes = [
      { data: 'dup', position: { topLeft: { x: 10, y: 200 } } },
      { data: 'dup', position: { topLeft: { x: 10, y: 10 } } },
      { data: 'other', position: { topLeft: { x: 10, y: 100 } } },
    ];
    const ordered = orderAndDedupeCodes(2, codes);
    assert(ordered.length === 2, 'Exact duplicates within a page are deduped');
    assert(ordered[0].data === 'other' && ordered[1].data === 'dup', 'Deduped codes keep reading order');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
  console.log('ALL TESTS PASSED');
}

main().catch(function (e) {
  console.error('Test error:', e);
  process.exit(2);
});
