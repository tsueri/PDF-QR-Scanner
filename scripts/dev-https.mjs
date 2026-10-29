#!/usr/bin/env node
// PROTOTYPE helper (ticket #30) — serve the repo over HTTPS with a self-signed cert so
// a real phone can open the camera prototype: getUserMedia needs a secure context, and
// http://<LAN-IP> is not one. Lives only on prototype branches; never merge to main.
//
// Usage:  node scripts/dev-https.mjs
//   → prints the LAN URL to open on the phone. Accept the self-signed-certificate
//     warning once (iOS: visit the URL, "show details", "visit this website").
//
// Needs the `openssl` CLI (used only to mint the throwaway cert under .prototype-cert/).

import { createServer } from 'node:https';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT || 8443);
const ROOT = resolve(process.cwd());
const CERT_DIR = join(ROOT, '.prototype-cert');
const KEY = join(CERT_DIR, 'key.pem');
const CERT = join(CERT_DIR, 'cert.pem');

if (!existsSync(KEY) || !existsSync(CERT)) {
    mkdirSync(CERT_DIR, { recursive: true });
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', KEY, '-out', CERT,
        '-days', '7', '-subj', '/CN=qr-prototype',
    ]);
    console.log('minted throwaway self-signed cert in .prototype-cert/ (7 days)');
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.y4m': 'video/y4m',
};

const server = createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
    console.log(`HTTPS dev server on https://localhost:${PORT}/`);
    console.log('Open on your phone (same Wi-Fi):');
    for (const list of Object.values(networkInterfaces())) {
        for (const ni of list || []) {
            if (ni.family === 'IPv4' && !ni.internal) {
                console.log(`  https://${ni.address}:${PORT}/index.html?camera=a|b|c`);
            }
        }
    }
});
