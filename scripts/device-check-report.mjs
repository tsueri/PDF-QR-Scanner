#!/usr/bin/env node
// device-check-report.mjs — turn device-check/results/*.json into device-check/findings.md.
// Run by scripts/device-check-wizard.sh (ticket #33), or directly once the phone has
// sent its results. Throwaway: lives only on prototype branches.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_DIR = 'device-check/results';
const OUT = 'device-check/findings.md';

const ok = (r) => r && r.ok ? '✓' : '✗';
const dims = (r) => r && r.ok ? `${r.w}×${r.h}` : `✗ ${r?.error || 'failed'}`;
const ms = (r) => r && r.ok && r.ms != null ? `${r.ms} ms` : '—';

function fixtureTable(t) {
    const rows = [
        ['heic12', '12 MP HEIC (4032×3024)'],
        ['jpeg12', '12 MP JPEG (4000×3000)'],
        ['jpeg48', '48 MP JPEG (8000×6000)'],
    ];
    let md = '| fixture | <img> | createImageBitmap (main) | createImageBitmap (worker) | full OffscreenCanvas read |\n';
    md += '|---|---|---|---|---|\n';
    for (const [key, name] of rows) {
        const f = t?.[key];
        if (!f) continue;
        md += `| ${name} | ${dims(f.img)} (${ms(f.img)}) | ${dims(f.bitmapMain)} (${ms(f.bitmapMain)}) | ${dims(f.bitmapWorker)} (${ms(f.bitmapWorker)}) | ${dims(f.fullRead)} (${ms(f.fullRead)}) |\n`;
    }
    return md;
}

function probeTable(list) {
    if (!list || !list.length) return '_not run (or OffscreenCanvas unavailable)_\n';
    let md = '| size | backing store | result |\n|---|---|---|\n';
    for (const p of list) {
        const mb = p.bytes ? `${(p.bytes / 1048576).toFixed(0)} MB` : '—';
        if (!p.ok) {
            md += `| ${p.w}×${p.h} | ${mb} | ✗ threw: ${p.error || 'failed'} |\n`;
        } else {
            md += `| ${p.w}×${p.h} | ${mb} | ${p.blank ? '**BLANK**' : `✓ corner ${p.sampleCorner.join(',')} · centre ${p.sampleCenter.join(',')}`} |\n`;
        }
    }
    return md;
}

function fileRow(label, rec) {
    if (!rec) return '';
    const img = rec.img && rec.img.ok ? `${rec.img.w}×${rec.img.h}` : '✗';
    const bmp = rec.bitmap && rec.bitmap.ok ? `${rec.bitmap.w}×${rec.bitmap.h}` : '✗';
    return `| ${label} | ${rec.name} | ${rec.sniff} | ${rec.size} | ${img} | ${bmp} |\n`;
}

function deviceSection(label, r) {
    const d = r.device || {};
    let md = `## ${label}\n\n`;
    md += `**Device:** ${d.userAgent || '—'}  \n`;
    md += `Platform: ${d.platform || '—'} · touch points: ${d.maxTouchPoints ?? '—'} · cores: ${d.hardwareConcurrency ?? '—'}${d.deviceMemory != null ? ` · deviceMemory: ${d.deviceMemory} GB` : ''}  \n`;
    md += `Screen: ${d.screen?.w}×${d.screen?.h} @ ${d.screen?.dpr}x · timezone: ${d.timezone || '—'} · sent: ${r.sentAt || '—'}\n\n`;

    const t = r.tests || {};
    if (t.bundled) {
        md += `### Bundled decode tests\n\n${fixtureTable(t.bundled)}\n`;
    }
    if (t.picker) {
        md += '### File picker (original HEIC or converted JPEG?)\n\n';
        md += '| input | file.name | sniff | bytes | <img> | bitmap |\n|---|---|---|---|---|---|\n';
        md += fileRow('accept="image/*"', t.picker.imageAccept);
        md += fileRow('accept=".heic,image/heic"', t.picker.heicAccept);
        md += '\n';
    }
    if (t.special && t.special.length) {
        md += '### Special HEIC variants\n\n';
        md += '| file.name | sniff | bytes | kind | <img> | bitmap |\n|---|---|---|---|---|---|\n';
        for (const rec of t.special) {
            const img = rec.img && rec.img.ok ? `${rec.img.w}×${rec.img.h}` : '✗';
            const bmp = rec.bitmap && rec.bitmap.ok ? `${rec.bitmap.w}×${rec.bitmap.h}` : '✗';
            md += `| ${rec.name} | ${rec.sniff} | ${rec.size} | ${rec.kind || '(unlabelled)'} | ${img} | ${bmp} |\n`;
        }
        md += '\n';
    }
    if (t.capture) {
        md += '### Camera capture path (`<input capture="environment">`)\n\n';
        md += '| file.name | sniff | bytes | <img> | bitmap |\n|---|---|---|---|---|\n';
        for (const rec of t.capture.files || []) {
            const img = rec.img && rec.img.ok ? `${rec.img.w}×${rec.img.h}` : '✗';
            const bmp = rec.bitmap && rec.bitmap.ok ? `${rec.bitmap.w}×${rec.bitmap.h}` : '✗';
            md += `| ${rec.name} | ${rec.sniff} | ${rec.size} | ${img} | ${bmp} |\n`;
        }
        md += `\nCamera format setting: ${t.capture.cameraSetting || '— not recorded —'}\n\n`;
    }
    if (t.canvasProbe) {
        md += '### Canvas area limit probe\n\n';
        md += '**Main-thread canvas:**\n\n' + probeTable(t.canvasProbe.main) + '\n';
        md += '**OffscreenCanvas in worker:**\n\n' + probeTable(t.canvasProbe.worker) + '\n';
    }
    if (t.cameraNotes && Object.keys(t.cameraNotes).length) {
        md += '### Camera prototype notes\n\n';
        for (const [k, v] of Object.entries(t.cameraNotes)) {
            if (v !== '' && v != null) md += `- **${k}:** ${v}\n`;
        }
        md += '\n';
    }
    return md;
}

function main() {
    if (!existsSync(RESULTS_DIR)) {
        console.error(`no results dir: ${RESULTS_DIR}`);
        process.exit(1);
    }
    const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json')).sort();
    if (!files.length) {
        console.error(`no results files in ${RESULTS_DIR}`);
        process.exit(1);
    }
    let md = `# Device check findings — ticket #33\n\n`;
    md += `Generated ${new Date().toISOString()} from ${RESULTS_DIR}/*.json.\n`;
    md += `Devices run: ${files.map((f) => f.replace(/\.json$/, '')).join(', ')}.\n\n`;
    for (const f of files) {
        const r = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8'));
        md += deviceSection(f.replace(/\.json$/, ''), r);
    }
    writeFileSync(OUT, md);
    console.log(`wrote ${OUT} (${files.length} device${files.length === 1 ? '' : 's'})`);
}

main();
