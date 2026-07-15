export async function buildZip(entries) {
    var JSZipConstructor = globalThis.JSZip;
    if (!JSZipConstructor) {
        JSZipConstructor = (await import('jszip')).default;
    }

    var zip = new JSZipConstructor();
    var usedNames = new Set();

    for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];

        var baseName = entry.filename.replace(/\.pdf$/i, '') + '.csv';

        var csvName = baseName;
        var suffix = 1;
        while (usedNames.has(csvName.toLowerCase())) {
            var dot = baseName.lastIndexOf('.');
            csvName = baseName.slice(0, dot) + ' (' + suffix + ')' + baseName.slice(dot);
            suffix++;
        }
        usedNames.add(csvName.toLowerCase());

        zip.file(csvName, entry.csv);
    }

    return zip.generateAsync({ type: 'blob' });
}
