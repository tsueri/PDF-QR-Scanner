// Regression test: verify tilted QR code detection via rotation sweep.
// Tests scanForQRCode logic against synthetically tilted QR codes at various angles.
// Run: node test-regression.js

const { createCanvas } = require('canvas');
const QRCode = require('qrcode');
const jsQR = require('jsqr');

const TEST_DATA = 'PDF-QR-Scanner-tilt-test';

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

function scanForQRCode(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height);
  let code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  });
  if (code) return code.data;

  for (let dir = 0; dir < 2; dir++) {
    for (let angle = 5; angle <= 45; angle += 5) {
      const sign = dir === 0 ? 1 : -1;
      const rotated = rotateCanvas(context.canvas, sign * angle);
      const rImgData = rotated.ctx.getImageData(0, 0, rotated.width, rotated.height);
      code = jsQR(rImgData.data, rImgData.width, rImgData.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code) return code.data;
    }
  }

  return null;
}

const results = [];

async function run() {
  const qrCanvas = createCanvas(300, 300);
  await QRCode.toCanvas(qrCanvas, TEST_DATA, { width: 300, margin: 1 });

  // Test 1: Upright QR code (0°) — should still work
  {
    const result = scanForQRCode(qrCanvas.getContext('2d'), qrCanvas.width, qrCanvas.height);
    const pass = result === TEST_DATA;
    results.push({ name: 'Upright (0°) QR code', pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}: Upright (0°) QR code`);
  }

  // Test 2-9: Tilted QR codes at 5°, 10°, 15°, 20°, 25°, 30°, 35°, 40°
  const tiltAngles = [5, 10, 15, 20, 25, 30, 35, 40];
  for (const tilt of tiltAngles) {
    const tilted = rotateCanvas(qrCanvas, tilt);
    const result = scanForQRCode(tilted.ctx, tilted.width, tilted.height);
    const pass = result === TEST_DATA;
    results.push({ name: `Tilted ${tilt}° QR code`, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}: Tilted ${tilt}° QR code`);
  }

  const allPass = results.every((r) => r.pass);
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} tests passed`);
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  process.exit(allPass ? 0 : 1);
}

run().catch((e) => {
  console.error('Test error:', e);
  process.exit(2);
});
