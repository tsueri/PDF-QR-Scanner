(async function () {
    const { fileResultsToCSV } = await import('./csv.js');

    var passed = 0;
    var failed = 0;

    function eq(a, b, message) {
        if (a === b) {
            passed++;
            console.log('PASS:', message);
        } else {
            failed++;
            console.log('FAIL:', message);
            console.log('  expected:', JSON.stringify(b));
            console.log('  got:', JSON.stringify(a));
        }
    }

    // Test 1: Empty results returns header only
    eq(fileResultsToCSV('test.pdf', []), 'page,qr-code\n', 'Empty results returns header only');

    // Test 2: Single result
    eq(fileResultsToCSV('test.pdf', [{ page: 1, data: 'hello' }]), 'page,qr-code\n"1","hello"', 'Single result produces header + one quoted row');

    // Test 3: Multiple results
    eq(
        fileResultsToCSV('test.pdf', [
            { page: 1, data: 'hello' },
            { page: 3, data: 'world' }
        ]),
        'page,qr-code\n"1","hello"\n"3","world"',
        'Multiple results produces header + multiple quoted rows'
    );

    // Test 4: Comma in data is quoted
    eq(fileResultsToCSV('test.pdf', [{ page: 1, data: 'hello,world' }]), 'page,qr-code\n"1","hello,world"', 'Comma in data is quoted');

    // Test 5: Numeric data coerced
    eq(fileResultsToCSV('test.pdf', [{ page: 2, data: 12345 }]), 'page,qr-code\n"2","12345"', 'Numeric data coerced to string');

    // Test 6: Header is always present
    eq(fileResultsToCSV('test.pdf', [{ page: 1, data: 'x' }]).startsWith('page,qr-code\n'), true, 'Header is page,qr-code');

    // Test 7: Results join with newline
    {
        var csv = fileResultsToCSV('test.pdf', [
            { page: 1, data: 'a' },
            { page: 2, data: 'b' }
        ]);
        eq(csv.split('\n').length, 3, 'Two results produce three lines (header + 2 rows)');
    }

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) process.exit(1);
})().catch(function (e) {
    console.error('Test error:', e);
    process.exit(2);
});
