// PROTOTYPE (ticket #30) — throwaway screenshot capture for the camera UX variants.
// Lives only on prototype branches. Runs the real app with Chromium's fake camera
// (torch/zoom controls stay hidden: the fake device reports no such capabilities —
// research/camera-capture.md says they are feature-detected via getCapabilities()).
// Found-code states are injected through the prototype's debug hooks (window.__cxFound).
//
// Usage: node scripts/prototype-camera-shots.mjs

import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const PORT = 8137;
const OUT = 'src/prototype/screenshots';
mkdirSync(OUT, { recursive: true });

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(PORT, ok));

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

const browser = await puppeteer.launch({
    headless: 'new',
    args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--no-sandbox',
        '--disable-gpu',
    ],
});

async function withPage(viewport, url, fn) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    await fn(page);
    await page.close();
}

async function shot(page, name) {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
    await page.screenshot({ path: join(ROOT, OUT, name) });
    console.log('shot:', name);
}

async function startCamera(page) {
    // the camera flow only opens after the entry button ("Scan with camera") is tapped
    await page.evaluate(() => {
        const entry = document.querySelector('.cx-entry');
        if (entry) entry.click();
    });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
    await page.evaluate(() => {
        const btn = document.querySelector('.cx-perm .cx-perm__start');
        if (btn) btn.click();
    });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
}

async function injectFounds(page, payloads) {
    await page.evaluate((list) => {
        list.forEach((p) => window.__cxFound(p));
    }, payloads);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 350)));
}

const base = `http://localhost:${PORT}/index.html`;

// variant A — permission (desktop), live (mobile), found + sheet expanded (mobile), landing (desktop)
await withPage(DESKTOP, `${base}?camera=a`, async (page) => {
    await shot(page, 'camera-a-permission.png');
});
await withPage(MOBILE, `${base}?camera=a`, async (page) => {
    await startCamera(page);
    await shot(page, 'camera-a-live-mobile.png');
    await injectFounds(page, ['https://tickets.example.com/ord/8841', 'hello-2026', 'https://tickets.example.com/ord/8841']);
    await page.evaluate(() => document.querySelector('.cx-sheet__head').click());
    await shot(page, 'camera-a-found-mobile.png');
    await page.evaluate(() => window.__cxDone());
    await shot(page, 'camera-a-landing.png');
});

// variant B — inline card live with codes (desktop + mobile), landing (desktop)
await withPage(DESKTOP, `${base}?camera=b`, async (page) => {
    await startCamera(page);
    await injectFounds(page, ['https://shop.example.com/p/A-1042', 'WIFI:T:WPA;S:Proto;P:secret;;']);
    await shot(page, 'camera-b-live.png');
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Finish');
        if (btn) btn.click();
    });
    await shot(page, 'camera-b-landing.png');
});
await withPage(MOBILE, `${base}?camera=b`, async (page) => {
    await startCamera(page);
    await injectFounds(page, ['https://shop.example.com/p/A-1042', 'WIFI:T:WPA;S:Proto;P:secret;;', 'https://shop.example.com/p/A-1042']);
    await shot(page, 'camera-b-live-mobile.png');
});

// variant C — one-shot freeze review (mobile), continuous stack (mobile), live (desktop)
await withPage(MOBILE, `${base}?camera=c`, async (page) => {
    await startCamera(page);
    await shot(page, 'camera-c-live-mobile.png');
    await injectFounds(page, ['https://menu.example.com/table/12']);
    await shot(page, 'camera-c-review-mobile.png');
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.cx-review button')].find((b) => b.textContent === 'Scan another');
        if (btn) btn.click();
    });
    await page.evaluate(() => window.__cxMode('continuous'));
    await injectFounds(page, ['one', 'two', 'three']);
    await shot(page, 'camera-c-continuous-mobile.png');
});
await withPage(DESKTOP, `${base}?camera=c`, async (page) => {
    await startCamera(page);
    await shot(page, 'camera-c-live.png');
});

await browser.close();
server.close();
console.log('done →', OUT);
