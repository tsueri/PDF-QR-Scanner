import JSZip from 'jszip';

globalThis.JSZip = JSZip;

const { buildZip } = await import('./zip.js');

var passed = 0;
var failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log('PASS:', message);
    } else {
        failed++;
        console.log('FAIL:', message);
    }
}

async function verifyZip(blob, expectedNames, label) {
    try {
        var buf = await blob.arrayBuffer();
        var loaded = await JSZip.loadAsync(buf);
        var actualNames = Object.keys(loaded.files).sort();
        var expectedSorted = expectedNames.slice().sort();

        var match = actualNames.length === expectedSorted.length &&
            actualNames.every(function (n, i) { return n === expectedSorted[i]; });

        if (match) {
            passed++;
            console.log('PASS:', label);
        } else {
            failed++;
            console.log('FAIL:', label);
            console.log('  expected filenames:', JSON.stringify(expectedSorted));
            console.log('  got filenames:', JSON.stringify(actualNames));
        }
    } catch (e) {
        failed++;
        console.log('FAIL:', label, '(' + e.message + ')');
    }
}

// Test 1: Single entry
{
    var blob = await buildZip([
        { filename: 'report.pdf', csv: 'page,qr-code\n"1","hello"' }
    ]);
    await verifyZip(blob, ['report.csv'], 'Single entry: report.pdf -> report.csv');
}

// Test 2: Two different files
{
    var blob = await buildZip([
        { filename: 'a.pdf', csv: 'aaa' },
        { filename: 'b.pdf', csv: 'bbb' }
    ]);
    await verifyZip(blob, ['a.csv', 'b.csv'], 'Two different files produce two CSVs');
}

// Test 3: Collision with same name
{
    var blob = await buildZip([
        { filename: 'foo.pdf', csv: 'first' },
        { filename: 'foo.pdf', csv: 'second' }
    ]);
    await verifyZip(blob, ['foo.csv', 'foo (1).csv'], 'Collision: second foo.pdf gets (1) suffix');
}

// Test 4: Case-insensitive collision
{
    var blob = await buildZip([
        { filename: 'Foo.pdf', csv: 'first' },
        { filename: 'foo.pdf', csv: 'second' }
    ]);
    await verifyZip(blob, ['Foo.csv', 'foo (1).csv'], 'Case-insensitive collision: second gets (1) suffix');
}

// Test 5: Multiple collisions increment suffix
{
    var blob = await buildZip([
        { filename: 'bar.pdf', csv: 'a' },
        { filename: 'bar.pdf', csv: 'b' },
        { filename: 'bar.pdf', csv: 'c' }
    ]);
    await verifyZip(blob, ['bar.csv', 'bar (1).csv', 'bar (2).csv'], 'Three-way collision: (1) and (2) suffixes');
}

// Test 6: File without .pdf extension
{
    var blob = await buildZip([
        { filename: 'notes', csv: 'hello' }
    ]);
    await verifyZip(blob, ['notes.csv'], 'File without .pdf extension gets .csv appended');
}

// Test 7: Empty entries
{
    var blob = await buildZip([]);
    await verifyZip(blob, [], 'Empty entries produces empty zip');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
