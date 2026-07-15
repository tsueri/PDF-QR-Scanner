export function fileResultsToCSV(fileName, results) {
    var header = 'page,qr-code\n';
    var rows = results.map(function (r) {
        return '"' + String(r.page) + '","' + String(r.data) + '"';
    }).join('\n');
    return header + rows;
}
