// Đọc file xuất (.xlsx bằng exceljs, .docx bằng jszip + XML) để kiểm tra nội dung thật.
const fs = require('fs');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

/** Trả {wb, ws, rows: [[giá trị ô]], cells: [[ô exceljs]], protected} của sheet đầu. */
async function readXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const rows = [];
  const cells = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const vals = [];
    const cs = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c);
      vals.push(cellValue(cell));
      cs.push(cell);
    }
    rows[r - 1] = vals;
    cells[r - 1] = cs;
  });
  // bảo vệ sheet / workbook
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const isProtected = /<sheetProtection\b/.test(sheetXml) || /<workbookProtection\b/.test(wbXml);
  const hasImages = Object.keys(zip.files).some((f) => f.startsWith('xl/media/'));
  return { wb, ws, rows, cells, isProtected, hasImages, sheetCount: wb.worksheets.length };
}

/** Giá trị hiển thị được của ô: công thức ⇒ kết quả lưu sẵn; rich text ⇒ chuỗi. */
function cellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return v.result ?? null;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    if (v instanceof Date) return v;
  }
  return v;
}

/** Tìm dòng (chỉ số 0) đầu tiên có ô chứa chuỗi/regex. */
function findRow(rows, re) {
  const m = typeof re === 'string' ? (s) => s.includes(re) : (s) => re.test(s);
  return rows.findIndex((r) => r && r.some((v) => typeof v === 'string' && m(v)));
}

/** Đọc .docx: văn bản các đoạn, các bảng (mỗi bảng: mảng dòng, mỗi dòng mảng ô văn bản), có khóa không. */
async function readDocx(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file('word/document.xml').async('string');
  const settings = zip.file('word/settings.xml') ? await zip.file('word/settings.xml').async('string') : '';
  const text = (frag) =>
    [...frag.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
      .map((m) => m[1])
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  const tables = [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map((t) =>
    [...t[1].matchAll(/<w:tr[ >]([\s\S]*?)<\/w:tr>/g)].map((r) => [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) => text(c[1]).trim())),
  );
  const paragraphs = [...xml.matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)].map((p) => text(p[1]).trim()).filter(Boolean);
  const isProtected = /<w:documentProtection\b/.test(settings) && !/w:enforcement="(0|false)"/.test(settings);
  const hasImages = Object.keys(zip.files).some((f) => f.startsWith('word/media/'));
  return { xml, tables, paragraphs, allText: text(xml), isProtected, hasImages };
}

module.exports = { readXlsx, readDocx, findRow, cellValue };
