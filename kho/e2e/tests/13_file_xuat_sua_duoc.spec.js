// Câu chuyện 13 — Phiếu nhập/xuất xuất ra Excel/Word để gửi khách và SỬA TIẾP được (YEU_CAU mục 4, REQ-071…074, 087):
// bảng thật, số là ô số, tiếng Việt nguyên vẹn, không khóa; mở file bằng thư viện thuần JS, thêm dòng/cột, lưu lại,
// mở lại vẫn đọc được.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, readDocx, findRow } = require('../lib/files');
const { OUT } = require('../lib/env');
const { COMPANY } = require('../lib/data');

test.describe.configure({ mode: 'serial' });

const P = { code: 'CUT40', name: 'Máy cắt plasma CUT-40 (điện 220V)', unit: 'Cái', group_code: 'MAY', group_name: 'Máy hàn', sale_price: 6500000, purchase_price: 5200000 };
const Q = { code: 'DAUCATP80', name: 'Đầu cắt plasma P80 – bộ đủ phụ kiện', unit: 'Bộ', group_code: 'MAY', group_name: 'Máy hàn', sale_price: 850000, purchase_price: 610000 };
const SUP = { code: 'VIETHAN', name: 'Công ty TNHH Thiết bị hàn Việt – Hàn', is_supplier: true, opening_payable: 1250000, address: 'Số 7, đường Nguyễn Ảnh Thủ, Hóc Môn' };

test.describe('Câu chuyện 13: file Excel/Word của phiếu sửa tiếp được', () => {
  let page;
  let ctx;
  const no = {};
  const files = {};
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    await api.ensureProduct(P);
    await api.ensureProduct(Q);
    await api.ensurePartner(SUP);
    await api.ensureCompany(COMPANY);
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    ({ ctx, page } = await openAs(browser, 'hoa', 'hoa123456', 'hoa'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-023 REQ-071 Phiếu nhập mua (có số lẻ) → Xuất Excel: đúng tiêu đề, NCC, số là số, Nợ cũ/Tổng nợ', async () => {
    no.nk = await ui.enterDoc(page, {
      type: 'purchase',
      date: '20/07/2026',
      partner: 'viethan',
      partnerName: SUP.name,
      wh: 'KHO4',
      note: 'Hàng về đợt tháng 7',
      lines: [
        { code: P.code, qty: 3 },
        { code: Q.code, qty: '2,5', price: '610.500' },
      ],
    });
    files.xlsx = (await ui.exportDoc(page, 'xlsx', '13-phieu-nhap.xlsx')).file;
    const x = await readXlsx(files.xlsx);
    expect(x.isProtected).toBe(false);
    expect(x.hasImages).toBe(false);
    expect(findRow(x.rows, 'PHIẾU NHẬP KHO MUA HÀNG')).toBeGreaterThanOrEqual(0);
    expect(findRow(x.rows, SUP.name)).toBeGreaterThanOrEqual(0);
    expect(findRow(x.rows, 'Hàng về đợt tháng 7')).toBeGreaterThanOrEqual(0);
    const h = findRow(x.rows, /^Tên hàng$/);
    expect(x.rows[h + 1].slice(1, 7)).toEqual([P.code, P.name, 'Cái', 3, 5200000, 15600000]);
    expect(x.rows[h + 2].slice(1, 7)).toEqual([Q.code, Q.name, 'Bộ', 2.5, 610500, 1526250]);
    // số lẻ hiển thị số lẻ
    expect(x.cells[h + 2][4].numFmt).toMatch(/0[.,]0/);
    const cong = x.rows[h + 3];
    expect(cong[6]).toBe(15600000 + 1526250);
    expect(x.rows[findRow(x.rows, /^Nợ cũ/)][6]).toBe(1250000);
    expect(x.rows[findRow(x.rows, /^Tổng nợ/)][6]).toBe(1250000 + 17126250);
  });

  test('REQ-074 REQ-087 Mở file Excel, chèn thêm 1 dòng hàng và 1 cột "Ghi chú giao hàng", lưu, mở lại vẫn đúng', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(files.xlsx);
    const ws = wb.worksheets[0];
    let h = 0;
    ws.eachRow((row, r) => {
      if (!h && row.values.includes('Tên hàng')) h = r;
    });
    ws.spliceRows(h + 3, 0, [3, 'DV', 'Phí bốc xếp (khách tự thêm)', '', 1, 150000, 150000]);
    ws.getRow(h).getCell(9).value = 'Ghi chú giao hàng';
    ws.getRow(h + 1).getCell(9).value = 'Giao tại xưởng Hóc Môn';
    const edited = path.join(OUT, 'files', '13-phieu-nhap-da-sua.xlsx');
    await wb.xlsx.writeFile(edited);
    const x = await readXlsx(edited);
    const hh = findRow(x.rows, /^Tên hàng$/);
    expect(x.rows[hh + 3].slice(1, 3)).toEqual(['DV', 'Phí bốc xếp (khách tự thêm)']);
    expect(x.rows[hh][8]).toBe('Ghi chú giao hàng');
    expect(x.rows[hh + 1][8]).toBe('Giao tại xưởng Hóc Môn');
    expect(x.rows[hh + 4][0]).toBe('Cộng');
  });

  test('REQ-073 REQ-074 REQ-087 Xuất Word phiếu nhập: bảng thật; thêm 1 dòng vào bảng, lưu lại, mở lại đọc được', async () => {
    files.docx = (await ui.exportDoc(page, 'docx', '13-phieu-nhap.docx')).file;
    const d = await readDocx(files.docx);
    expect(d.isProtected).toBe(false);
    expect(d.allText).toContain('PHIẾU NHẬP KHO MUA HÀNG');
    expect(d.allText).toContain(SUP.name);
    expect(d.allText).toContain(COMPANY.name);
    const t = d.tables.find((tb) => tb[0] && tb[0].includes('Tên hàng'));
    expect(t[2].slice(1, 7)).toEqual([Q.code, Q.name, 'Bộ', '2,5', '610.500', '1.526.250']);
    expect(d.allText).toMatch(/Nợ cũ:\s*1\.250\.000/);
    // sửa: nhân bản dòng 1 của bảng thành một dòng mới (như người dùng thêm dòng trong Word)
    const zip = await JSZip.loadAsync(fs.readFileSync(files.docx));
    const xml = await zip.file('word/document.xml').async('string');
    const rows = [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
    const lineRow = rows.find((r) => r.includes(P.code));
    const added = lineRow.replace(P.code, 'THEM-MOI').replace(P.name, 'Dòng khách tự thêm trong Word');
    const xml2 = xml.replace(lineRow, lineRow + added);
    zip.file('word/document.xml', xml2);
    const edited = path.join(OUT, 'files', '13-phieu-nhap-da-sua.docx');
    fs.writeFileSync(edited, await zip.generateAsync({ type: 'nodebuffer' }));
    const d2 = await readDocx(edited);
    const t2 = d2.tables.find((tb) => tb[0] && tb[0].includes('Tên hàng'));
    expect(t2.length).toBe(t.length + 1);
    expect(t2[2][2]).toBe('Dòng khách tự thêm trong Word');
  });

  test('REQ-071 REQ-072 Chuyển kho và trả hàng NCC cũng xuất được Excel với đúng tiêu đề', async () => {
    no.ck = await ui.enterDoc(page, { type: 'transfer', date: '21/07/2026', wh: 'KHO4', toWh: 'KHO2', lines: [{ code: P.code, qty: 1 }] });
    let x = await readXlsx((await ui.exportDoc(page, 'xlsx', '13-chuyen-kho.xlsx')).file);
    expect(findRow(x.rows, 'PHIẾU CHUYỂN KHO NỘI BỘ')).toBeGreaterThanOrEqual(0);
    expect(x.rows[findRow(x.rows, /^Tên hàng$/) + 1]).toContain(P.code);
    no.xkTra = await ui.enterDoc(page, { type: 'purchase_return', date: '22/07/2026', partner: 'viethan', partnerName: SUP.name, wh: 'KHO4', lines: [{ code: Q.code, qty: '0,5', price: '610.500' }] });
    x = await readXlsx((await ui.exportDoc(page, 'xlsx', '13-tra-hang-ncc.xlsx')).file);
    expect(findRow(x.rows, 'PHIẾU XUẤT TRẢ HÀNG NHÀ CUNG CẤP')).toBeGreaterThanOrEqual(0);
    const h = findRow(x.rows, /^Tên hàng$/);
    expect(x.rows[h + 1].slice(4, 7)).toEqual([0.5, 610500, 305250]);
  });
});
