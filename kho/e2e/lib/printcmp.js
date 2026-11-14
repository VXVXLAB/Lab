// So khớp bản in trên màn hình (PrintSheet / VoucherPrint) với file Excel và Word của cùng phiếu.
// Mỗi nguồn được đọc thành cùng một "mô hình" rồi so từng phần: tiêu đề, phụ đề, số, ngày, các dòng thông tin
// ("Khách hàng: … (MÃ)", "Xuất từ kho: …", "Họ tên người nộp tiền: …"…), bảng dòng, dòng tổng, Nợ cũ/Tổng nợ,
// "Bằng chữ", ô ký, dòng cuối (Ghi sổ bởi / Lập bởi / Phiếu tạm).
const { readXlsx, readDocx } = require('./files');

const norm = (s) => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const isNumText = (s) => /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) || /^-?\d+(,\d+)?$/.test(s);
/** Ô bảng → số nếu là số (chuỗi VN hoặc ô số Excel), ngược lại chuỗi đã chuẩn hóa; trống → '' */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const t = norm(v);
  if (isNumText(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return t;
}
function meta(text) {
  const t = norm(text);
  return {
    no: (/Số:\s*([A-Z]+\d+)/.exec(t) || [])[1] ?? null,
    date: (/(\d{2}\/\d{2}\/\d{4})/.exec(t) || [])[1] ?? null,
    account: norm(((/\d{2}\/\d{2}\/\d{4}(.*)$/.exec(t) || [])[1] ?? '').replace(/^\s*·\s*/, '')) || null,
  };
}
const footTail = (t) => norm(norm(t).split('·').slice(1).join('·'));

/** Đọc bản in đang mở trong hộp xem trước (scope = locator của .print-sheet). */
async function readPrint(sheet) {
  return sheet.evaluate((el) => {
    const n = (s) => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    const q = (s) => el.querySelector(s);
    const isVoucher = el.classList.contains('voucher-sheet');
    const info = [...el.querySelectorAll('table.ps-info tr')].map((tr) => n([...tr.querySelectorAll('td')].map((td) => td.textContent).join(' ')));
    const body = [...el.querySelectorAll('table.ps-lines tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => n(td.textContent)));
    const sumIdx = body.findIndex((r) => /^(Cộng|Tổng số tiền)$/.test(r[0]));
    return {
      isVoucher,
      title: n(q('.ps-title')?.textContent),
      subtitle: n(q('.ps-subtitle')?.textContent) || null,
      metaText: n(q('.ps-meta')?.textContent),
      info,
      header: [...el.querySelectorAll('table.ps-lines thead th')].map((th) => n(th.textContent)),
      rows: sumIdx >= 0 ? body.slice(0, sumIdx) : body,
      sum: sumIdx >= 0 ? body[sumIdx] : null,
      debt: [...el.querySelectorAll('table.ps-debt tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => n(td.textContent))),
      words: [...el.querySelectorAll('.ps-words')].map((d) => n(d.textContent)),
      dateLine: n(q('.ps-date')?.textContent),
      signers: [...el.querySelectorAll('.ps-signs > div > b')].map((b) => n(b.textContent)),
      signHint: n(q('.ps-sign-hint')?.textContent),
      foot: n(q('.ps-foot')?.textContent),
    };
  });
}

/** Chuyển bản in thành mô hình so được. */
function fromPrint(p) {
  const m = meta(p.metaText);
  const nonEmpty = (r) => r;
  return {
    title: p.title,
    subtitle: p.subtitle,
    no: m.no,
    date: m.date,
    account: p.isVoucher ? m.account : null,
    info: p.info.map(norm),
    header: p.header,
    rows: p.rows.map((r) => nonEmpty(r).map(cell)),
    sum: p.sum ? [p.sum[0], ...p.sum.slice(1).map(cell).filter((v) => v !== '')] : null,
    debt: p.debt.map(([l, v]) => [norm(l), cell(v)]),
    words: p.words.map(norm),
    dateLine: p.dateLine,
    signers: p.signers,
    signHint: p.signHint,
    footTail: footTail(p.foot),
  };
}

/** Đọc file Excel của phiếu thành mô hình. */
async function fromXlsx(file, printModel) {
  const x = await readXlsx(file);
  const rows = x.rows.map((r) => (r || []).map((v) => (typeof v === 'string' ? norm(v) : v)));
  const uniq = (r) => [...new Set(r.filter((v) => v !== null && v !== ''))];
  const ti = rows.findIndex((r) => uniq(r).length === 1 && uniq(r)[0] === printModel.title);
  const hi = rows.findIndex((r, i) => i > ti && r[0] === 'STT');
  const header = uniq(rows[hi]);
  const between = rows.slice(ti + 1, hi).map(uniq).filter((u) => u.length);
  const metaRow = between.find((u) => /^Số:/.test(String(u[0])));
  const subtitle = between.find((u) => / — chưa ghi sổ/.test(String(u[0])));
  const info = between.filter((u) => u !== metaRow && u !== subtitle).map((u) => norm(u.join(' ')));
  const si = rows.findIndex((r, i) => i > hi && /^(Cộng|Tổng số tiền)$/.test(String(r[0])));
  const lineRows = rows.slice(hi + 1, si).filter((r) => r.some((v) => v !== null && v !== '')).map((r) => r.slice(0, header.length).map(cell));
  const sum = [rows[si][0], ...rows[si].slice(1).filter((v) => v !== null && v !== '').map(cell)];
  const after = rows.slice(si + 1).map(uniq).filter((u) => u.length);
  const debt = after.filter((u) => /^(Nợ cũ:|Tổng nợ)/.test(String(u[0]))).map((u) => [norm(u[0]), cell(u[1])]);
  const words = after.filter((u) => /^(Bằng chữ:|Kèm theo:)/.test(String(u[0]))).map((u) => norm(u[0]));
  const dateLine = (after.find((u) => /^Ngày …/.test(String(u[0]))) || [null])[0];
  const signers = after.find((u) => printModel.signers.length && u.length === printModel.signers.length && u.includes(printModel.signers[0])) || [];
  const signHint = (after.find((u) => /^\(Ký/.test(String(u[0]))) || [null])[0];
  const foot = (after.find((u) => /^Xuất file lúc/.test(String(u[0]))) || [''])[0];
  const m = meta(metaRow ? metaRow.join(' ') : '');
  return {
    title: ti >= 0 ? printModel.title : null,
    subtitle: subtitle ? norm(subtitle[0]) : null,
    no: m.no,
    date: m.date,
    account: printModel.account === null ? null : m.account,
    info,
    header,
    rows: lineRows,
    sum,
    debt,
    words,
    dateLine,
    signers,
    signHint,
    footTail: footTail(foot),
    raw: x,
  };
}

/** Đọc file Word của phiếu thành mô hình. */
async function fromDocx(file, printModel) {
  const d = await readDocx(file);
  const paras = d.paragraphs.map(norm);
  const ti = paras.indexOf(printModel.title);
  const lt = d.tables.find((t) => t[0] && t[0][0] === 'STT');
  const st = d.tables[d.tables.length - 1];
  const headerCells = lt ? lt[0] : [];
  const tableStart = paras.indexOf('STT', ti);
  const between = paras.slice(ti + 1, tableStart >= 0 ? tableStart : undefined);
  const metaP = between.find((p) => /^Số:/.test(p));
  const subtitle = between.find((p) => / — chưa ghi sổ/.test(p)) ?? null;
  const info = between.filter((p) => p !== metaP && p !== subtitle);
  const body = lt ? lt.slice(1) : [];
  const si = body.findIndex((r) => /^(Cộng|Tổng số tiền)$/.test(norm(r[0])));
  const m = meta(metaP ?? '');
  const debt = paras
    .filter((p) => /^(Nợ cũ:|Tổng nợ)/.test(p))
    .map((p) => {
      const mm = /^(.*:)\s*(.*)$/.exec(p);
      return [norm(mm[1]), cell(mm[2])];
    });
  return {
    title: ti >= 0 ? printModel.title : null,
    subtitle,
    no: m.no,
    date: m.date,
    account: printModel.account === null ? null : m.account,
    info,
    header: headerCells.map(norm),
    rows: body.slice(0, si).map((r) => r.map(cell)),
    sum: si >= 0 ? [norm(body[si][0]), ...body[si].slice(1).map(cell).filter((v) => v !== '')] : null,
    debt,
    words: paras.filter((p) => /^(Bằng chữ:|Kèm theo:)/.test(p)),
    dateLine: paras.find((p) => /^Ngày …/.test(p)) ?? null,
    signers: st && st[0] ? st[0].map(norm) : [],
    signHint: st && st[1] ? norm(st[1][0]) : null,
    footTail: footTail(paras.find((p) => /^Xuất file lúc/.test(p)) ?? ''),
    protected: d.isProtected,
  };
}

/** Bỏ trường kỹ thuật để so sánh bằng toEqual. */
function comparable(m) {
  const { raw, protected: _p, ...rest } = m;
  return rest;
}

module.exports = { readPrint, fromPrint, fromXlsx, fromDocx, comparable, norm };

/**
 * Trên phiếu đang mở (đã lưu): Ctrl+P đọc bản in, đóng; xuất Excel và Word qua nút "In ▾"; trả 3 mô hình.
 * `tag` dùng đặt tên file trong out/files.
 */
async function printAndExports(page, tag) {
  const ui = require('./ui');
  const { expect } = require('playwright/test');
  await ui.blurAll(page);
  await page.keyboard.press('Control+p');
  const dlg = page.locator('.ant-modal').filter({ has: page.locator('.print-sheet') });
  await expect(dlg).toBeVisible();
  const p = fromPrint(await readPrint(dlg.locator('.print-sheet')));
  await dlg.getByRole('button', { name: 'Đóng' }).click();
  await expect(dlg).toBeHidden();
  const xf = await ui.exportDoc(page, 'xlsx', `${tag}.xlsx`);
  const df = await ui.exportDoc(page, 'docx', `${tag}.docx`);
  const x = await fromXlsx(xf.file, p);
  const d = await fromDocx(df.file, p);
  return { print: p, xlsx: x, docx: d, xlsxFile: xf.file, docxFile: df.file };
}

module.exports.printAndExports = printAndExports;
