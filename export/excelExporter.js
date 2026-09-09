/**
 * excelExporter.js
 * Builds .xlsx (via the bundled SheetJS library) and .csv files from an
 * array of member records, and triggers a browser download. Runs in the
 * popup's context (popup.html loads lib/xlsx/xlsx.core.min.js before this
 * file), not inside the scraped page.
 */

const EXPORT_COLUMNS = [
  { key: 'country', header: 'Country' },
  { key: 'region', header: 'Region' },
  { key: 'city', header: 'City' },
  { key: 'chapterName', header: 'Chapter Name' },
  { key: 'chapterId', header: 'Chapter ID' },
  { key: 'memberId', header: 'Member ID' },
  { key: 'memberName', header: 'Member Name' },
  { key: 'companyName', header: 'Company Name' },
  { key: 'profession', header: 'Profession' },
  { key: 'businessCategory', header: 'Business Category' },
  { key: 'phone', header: 'Phone' },
  { key: 'email', header: 'Email' },
  { key: 'website', header: 'Website' },
  { key: 'address', header: 'Address' },
  { key: 'state', header: 'State' },
  { key: 'profileUrl', header: 'Profile URL' },
  { key: 'chapterUrl', header: 'Chapter URL' },
  { key: 'sourceUrl', header: 'Source URL' },
  { key: 'scrapedAt', header: 'Scraped At' }
];

function recordsToAOA(records) {
  const header = EXPORT_COLUMNS.map((c) => c.header);
  const rows = records.map((r) => EXPORT_COLUMNS.map((c) => r[c.key] || ''));
  return [header, ...rows];
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    // revoke shortly after; downloads.download copies the data itself
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

function safeName(str) {
  return (str || 'Unknown').toString().replace(/[^a-z0-9\-_]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function exportToExcel(records, { chapterName, filenameOverride } = {}) {
  const aoa = recordsToAOA(records);
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!pane'] = { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

  // Auto-size columns (approximate, based on max content length per column)
  ws['!cols'] = EXPORT_COLUMNS.map((col, i) => {
    let maxLen = col.header.length;
    for (const row of aoa.slice(1)) {
      const val = row[i] ? String(row[i]) : '';
      if (val.length > maxLen) maxLen = val.length;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
  });

  // Turn URL-like columns into real hyperlinks
  const urlColumns = ['Profile URL', 'Chapter URL', 'Source URL', 'Website'];
  EXPORT_COLUMNS.forEach((col, colIdx) => {
    if (!urlColumns.includes(col.header)) return;
    aoa.slice(1).forEach((row, rowIdx) => {
      const val = row[colIdx];
      if (val && /^https?:\/\//i.test(val)) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIdx + 1, c: colIdx });
        if (ws[cellRef]) {
          ws[cellRef].l = { Target: val };
        }
      }
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Members');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });

  const filename = filenameOverride || `BNI_${safeName(chapterName)}_${todayISO()}.xlsx`;
  triggerDownload(blob, filename);
  return filename;
}

function exportToCSV(records, { chapterName, filenameOverride } = {}) {
  const aoa = recordsToAOA(records);
  const csv = aoa
    .map((row) => row.map((cell) => {
      const val = (cell === undefined || cell === null) ? '' : String(cell);
      if (/[",\n]/.test(val)) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(','))
    .join('\r\n');

  // UTF-8 BOM so Excel opens accented/non-Latin characters correctly
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const filename = filenameOverride || `BNI_${safeName(chapterName)}_${todayISO()}.csv`;
  triggerDownload(blob, filename);
  return filename;
}

window.BNIExcelExporter = { exportToExcel, exportToCSV, EXPORT_COLUMNS };
