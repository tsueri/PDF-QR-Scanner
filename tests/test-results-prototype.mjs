// PROTOTYPE — throwaway check for the results-view variants (ticket #29).
// Lives only on the prototype/results-view branch; never merge to main.
//
// Serves the repo over http and drives the real page with Puppeteer:
// for every variant × run it asserts the variant's signature content renders,
// then screenshots desktop (1000×900) and mobile (390×844).

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = process.cwd();
const PORT = 8932;
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
    '.map': 'application/json'
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
        let path = url.pathname;
        if (path === '/') path = '/index.html';
        const file = join(ROOT, path);
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
        res.end(data);
    } catch (e) {
        res.writeHead(404);
        res.end('not found');
    }
});

await new Promise((r) => server.listen(PORT, r));
console.log(`serving on http://127.0.0.1:${PORT}`);

const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const errors = [];
const page = await browser.newPage();
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
});

await mkdir('src/prototype/screenshots', { recursive: true });

const VARIANTS = ['a', 'b', 'c'];
const RUNS = ['mixed', 'big', 'camera'];

// signatures: what each variant × run must show
const SIGNATURES = {
    a: {
        mixed: ['.rp-export__label', '.rp-listA', '.rp-listA__head', '.rp-act--open', '.rp-payload__binary', '.rp-payload__more'],
        big: ['.rp-export__label', '.rp-listA__head'],
        camera: ['.rp-export__label', '.rp-listA']
    },
    b: {
        mixed: ['.rp-summary', '.rp-card', '.rp-card__toggle', '.rp-card__body', '.rp-card__acts'],
        big: ['.rp-summary', '.rp-card'],
        camera: ['.rp-summary', '.rp-card']
    },
    c: {
        mixed: ['.rp-sum__bignum', '.rp-table', '.rp-sym', '.rp-table__empty'],
        big: ['.rp-sum__bignum', '.rp-table'],
        camera: ['.rp-sum__bignum', '.rp-table']
    }
};

// per-variant textual expectations per run
const EXPECT = {
    a: {
        mixed: (t) => t.includes('13 codes') && t.includes('2026') && t.includes('EAN-13') && t.includes('binary'),
        big: (t) => t.includes('203 codes') && t.includes('catalog-2026.pdf'),
        camera: (t) => t.includes('1 code') && t.includes('Download CSV')
    },
    b: {
        mixed: (t) => t.includes('13 codes') && t.includes('Copy source') && t.includes('batch-2026.zip'),
        big: (t) => t.includes('203 codes') && t.includes('2026'),
        camera: (t) => t.includes('1 code') && t.includes('Download CSV')
    },
    c: {
        mixed: (t) => t.match(/13\s*codes/) && t.includes('EAN-13 ×1') && t.includes('1 source with no codes'),
        big: (t) => t.match(/203\s*codes/) && t.includes('catalog-2026.pdf'),
        camera: (t) => t.match(/1\s*code/) && t.includes('Download CSV')
    }
};

let failures = 0;

for (const variant of VARIANTS) {
    for (const run of RUNS) {
        const url = `http://127.0.0.1:${PORT}/?variant=${variant}&run=${run}`;
        await page.goto(url, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.rp-root', { timeout: 5000 });
        await page.waitForSelector('.rp-bar', { timeout: 5000 });

        for (const sel of SIGNATURES[variant][run]) {
            const found = await page.$(sel);
            if (!found) {
                failures++;
                console.log(`FAIL ${variant}/${run}: missing selector ${sel}`);
            }
        }

        const text = await page.evaluate(() => document.querySelector('.rp-root').textContent);
        if (!EXPECT[variant][run](text)) {
            failures++;
            console.log(`FAIL ${variant}/${run}: text mismatch — ${text.slice(0, 160)}`);
        }

        // queue rows seeded?
        const queueRows = await page.$$eval('#fileList .file-row', (rows) => rows.length);
        const expectedRows = { mixed: 10, big: 4, camera: 1 }[run];
        if (queueRows !== expectedRows) {
            failures++;
            console.log(`FAIL ${variant}/${run}: queue rows ${queueRows}, expected ${expectedRows}`);
        }

        // desktop shot; mobile for one representative combo per variant
        await page.setViewport({ width: 1000, height: 900 });
        await page.screenshot({ path: `src/prototype/screenshots/results-${variant}-${run}.png`, fullPage: true });
        if (run === 'mixed' || run === 'big') {
            await page.setViewport({ width: 390, height: 844 });
            await page.screenshot({ path: `src/prototype/screenshots/results-${variant}-${run}-mobile.png`, fullPage: true });
        }
        console.log(`ok ${variant}/${run} (queue rows: ${queueRows})`);
    }
}

// interaction: switch runs from the bar, cycle variants with arrows
await page.goto(`http://127.0.0.1:${PORT}/?variant=a&run=mixed`, { waitUntil: 'networkidle0' });
await page.click('.rp-bar__run[data-run="big"]');
await page.waitForSelector('.rp-sum__bignum', { timeout: 5000 }).catch(() => {});
await page.keyboard.press('ArrowRight');
await page.waitForSelector('.rp-summary', { timeout: 5000 });
const url = page.url();
if (!url.includes('variant=b') || !url.includes('run=big')) {
    failures++;
    console.log(`FAIL: interaction — url is ${url}`);
} else {
    console.log('ok interaction: run switch + arrow cycle');
}

// copy button uses navigator.clipboard (needs permissions in headless; just assert no crash)
await page.goto(`http://127.0.0.1:${PORT}/?variant=a&run=mixed`, { waitUntil: 'networkidle0' });
await page.evaluate(() => navigator.clipboard.writeText('x').catch(() => {}));

await browser.close();
server.close();

if (errors.length) {
    failures += errors.length;
    for (const e of errors) console.log(`FAIL error: ${e}`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
