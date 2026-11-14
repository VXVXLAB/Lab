// Câu chuyện 3 — Ví dụ phiếu bán hàng của khách (YEU_CAU_PHAN_MEM.txt mục BÁN HÀNG 3), gõ HOÀN TOÀN bằng bàn phím:
// 5 dòng hàng, dòng DICHVU ghi chú không giá "TRẢ 01 ĐỒNG HỒ", dòng DICHVU "PHÍ SỬA XE" 400.000;
// Cộng 3.990.000; Nợ cũ 2.000.000; Tổng nợ 5.990.000. Kiểm tra trên màn hình, bản in, file .xlsx và .docx.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, readDocx, findRow } = require('../lib/files');
const { SLIP_PRODUCTS, THANHCONG, COMPANY } = require('../lib/data');

test.describe.configure({ mode: 'serial' });

const LINES = [
  { code: '4CA200A5', name: 'Súng hàn CO2 200A-5.0M (EU)', unit: 'Bộ', qty: 1, price: 600000, amount: 600000 },
  { code: 'CN249SS08', name: 'Béc CO2 Sunshine 0.8 mm', unit: 'Cái', qty: 50, price: 13000, amount: 650000 },
  { code: 'CN249SS10', name: 'Béc CO2 Sunshine 1.0 mm', unit: 'Cái', qty: 50, price: 13000, amount: 650000 },
  { code: 'COS10', name: 'Đầu cos (khoen đồng) 10mm (50c/bao)', unit: 'Cái', qty: 100, price: 6000, amount: 600000 },
  { code: 'K701832', name: 'Que hàn Kiswel K7018-3.2 (20kg)', unit: 'Thùng', qty: 1, price: 1090000, amount: 1090000 },
  { code: 'DICHVU', name: 'TRẢ 01 ĐỒNG HỒ', unit: '', qty: 1, price: null, amount: null },
  { code: 'DICHVU', name: 'PHÍ SỬA XE', unit: '', qty: 1, price: 400000, amount: 400000 },
];

test.describe('Câu chuyện 3: phiếu bán hàng theo ví dụ của khách, chỉ dùng bàn phím', () => {
  let page;
  let ctx;
  let api;
  let docNo;
  const before = {};
  const files = {};
  test.beforeAll(async ({ browser }) => {
    api = await Api.login();
    for (const p of SLIP_PRODUCTS) await api.ensureProduct(p);
    await api.ensurePartner(THANHCONG);
    await api.ensureCompany(COMPANY);
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    // chuẩn bị tồn KHO1 cho 5 mã (dữ liệu nền, không phải thao tác đang kiểm thử)
    await api.openingStock('KHO1', '2026-01-01', [
      { product_code: '4CA200A5', qty: 5 },
      { product_code: 'CN249SS08', qty: 100 },
      { product_code: 'CN249SS10', qty: 100 },
      { product_code: 'COS10', qty: 200 },
      { product_code: 'K701832', qty: 5 },
    ]);
    for (const l of LINES.slice(0, 5)) before[l.code] = (await api.stockOf(l.code)).total_stock;
    before.debt = await api.debtClosing('THANHCONG', 'receivable');
    ({ ctx, page } = await openAs(browser, 'lan', 'lan123456', 'lan'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-025 REQ-026 REQ-047 REQ-048 REQ-049 Gõ phiếu bằng bàn phím: F2 → ngày → khách → kho → 7 dòng', async () => {
    expect(before.debt).toBe(2000000);
    await ui.menu(page, 'Bán hàng', 'Phiếu bán');
    await ui.newDocByF2(page, /^Phiếu bán hàng/);
    // con trỏ đứng sẵn ở ô Khách hàng
    await expect(page.locator('#partner')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#doc_date')).toBeFocused();
    await page.keyboard.type('25/09/2026');
    await page.keyboard.press('Enter');
    await expect(page.locator('#partner')).toBeFocused();
    await page.keyboard.type('thanh cong', { delay: 20 });
    await expect(page.locator('.ant-select-item-option-active')).toContainText('Xưởng cơ khí Thành Công');
    await page.keyboard.press('Enter');
    await expect(page.locator('#warehouse')).toBeFocused();
    await expect(page.locator('.hf-partner .ant-select-selection-item')).toContainText('Xưởng cơ khí Thành Công');
    // cạnh tên khách có công nợ hiện tại (hướng dẫn: "Cạnh tên khách có công nợ hiện tại của khách")
    await expect(page.locator('.partner-debt')).toContainText('2.000.000');
    await page.keyboard.type('KHO1', { delay: 20 });
    await page.keyboard.press('Enter');
    await expect(page.locator('#note')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('input.code-input').first()).toBeFocused();
    for (const l of LINES) {
      if (l.code === 'DICHVU') await ui.typeLine(page, { code: 'DICHVU', desc: l.name, price: l.price === null ? undefined : l.price });
      else await ui.typeLine(page, { code: l.code, qty: l.qty }); // đơn giá tự điền theo giá bán (REQ-026)
    }
    const rows = await ui.readLines(page);
    expect(rows.length).toBe(7);
    rows.forEach((r, i) => {
      const e = LINES[i];
      expect(r.code).toBe(e.code === 'DICHVU' ? 'DV' : e.code);
      if (e.code !== 'DICHVU') {
        expect(r.name).toBe(e.name);
        expect(r.unit).toBe(e.unit);
      } else expect(r.name).toBe(e.name);
      expect(ui.vnNum(r.qty)).toBe(e.qty);
      expect(r.price === '' ? null : ui.vnNum(r.price)).toBe(e.price);
      expect(r.amount === '' ? null : ui.vnNum(r.amount)).toBe(e.amount);
    });
    expect(await ui.footerSum(page, 'Cộng')).toBe(3990000);
    await expect(page.locator('.check-ok')).toContainText('Đủ hàng — ghi sổ được');
    await ui.shot(page, '03-phieu-ban-dang-go');
  });

  test('REQ-034 REQ-049 Ctrl+S lưu tạm rồi F9 ghi sổ: Cộng 3.990.000, Nợ cũ 2.000.000, Tổng nợ 5.990.000', async () => {
    await ui.saveDraft(page);
    expect(await ui.footerSum(page, 'Nợ cũ')).toBe(2000000);
    expect(await ui.footerSum(page, 'Tổng nợ')).toBe(5990000);
    await expect(page.locator('.doc-sums')).toContainText('Tổng nợ đến 25/09/2026');
    docNo = await ui.postDoc(page);
    expect(docNo).toMatch(/^XK\d{5}$/);
    expect(await ui.footerSum(page, 'Cộng')).toBe(3990000);
    expect(await ui.footerSum(page, 'Nợ cũ')).toBe(2000000);
    expect(await ui.footerSum(page, 'Tổng nợ')).toBe(5990000);
    await ui.shot(page, '03-phieu-ban-da-ghi-so');
  });

  test('REQ-034 REQ-051 REQ-033 Công nợ khách tăng 3.990.000; tồn chỉ giảm hàng hóa, dòng DV không đổi tồn', async () => {
    expect(await api.debtClosing('THANHCONG', 'receivable')).toBe(2000000 + 3990000);
    for (const l of LINES.slice(0, 5)) expect((await api.stockOf(l.code)).total_stock, l.code).toBe(before[l.code] - l.qty);
  });

  test('REQ-032 REQ-073 Bản in (Ctrl+P): tiêu đề chính thức, đủ 7 dòng, DICHVU, Cộng, Nợ cũ, Tổng nợ', async () => {
    await ui.blurAll(page);
    await page.keyboard.press('Control+p');
    const dlg = page.getByRole('dialog', { name: 'Xem trước bản in' });
    await expect(dlg).toBeVisible();
    const sheet = dlg.locator('.print-sheet');
    await expect(sheet.locator('.ps-company')).toContainText(COMPANY.name);
    await expect(sheet.locator('.ps-title')).toHaveText('PHIẾU XUẤT KHO BÁN HÀNG');
    await expect(sheet).toContainText(docNo);
    await expect(sheet).toContainText('25/09/2026');
    const rows = await sheet.locator('table.ps-lines tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((t) => t.textContent.trim())));
    expect(rows.length).toBe(8);
    LINES.forEach((e, i) => {
      expect(rows[i][1]).toBe(e.code);
      expect(rows[i][2]).toBe(e.name);
      expect(ui.vnNum(rows[i][4])).toBe(e.qty);
      expect(rows[i][5] === '' ? null : ui.vnNum(rows[i][5])).toBe(e.price);
      expect(rows[i][6] === '' ? null : ui.vnNum(rows[i][6])).toBe(e.amount);
    });
    // số lượng in như mẫu khách: "1,0", "50,0"
    expect(rows[1][4]).toBe('50,0');
    expect(rows[7][0]).toBe('Cộng');
    expect(rows[7][rows[7].length - 1]).toBe('3.990.000');
    await expect(sheet.locator('.ps-debt')).toContainText('Nợ cũ:2.000.000');
    await expect(sheet.locator('.ps-debt')).toContainText('Tổng nợ (đến ngày 25/09/2026):5.990.000');
    await ui.shot(page, '03-ban-in-phieu-ban');
    await dlg.getByRole('button', { name: 'Đóng' }).click();
    await expect(dlg).toBeHidden();
  });

  test('REQ-072 REQ-074 REQ-087 Xuất Excel: bảng thật, số là số, Cộng/Nợ cũ/Tổng nợ đúng, không khóa', async () => {
    const { file, suggested } = await ui.exportDoc(page, 'xlsx', '03-phieu-ban.xlsx');
    files.xlsx = file;
    expect(suggested).toBe(`${docNo}.xlsx`);
    const x = await readXlsx(file);
    expect(x.isProtected).toBe(false);
    expect(x.hasImages).toBe(false);
    expect(findRow(x.rows, COMPANY.name)).toBeGreaterThanOrEqual(0);
    expect(findRow(x.rows, 'PHIẾU XUẤT KHO BÁN HÀNG')).toBeGreaterThanOrEqual(0);
    expect(findRow(x.rows, 'Xưởng cơ khí Thành Công')).toBeGreaterThanOrEqual(0);
    const h = findRow(x.rows, /^Tên hàng$/);
    expect(x.rows[h].slice(0, 7)).toEqual(['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền']);
    LINES.forEach((e, i) => {
      const r = x.rows[h + 1 + i];
      expect(r[0]).toBe(i + 1);
      if (e.code !== 'DICHVU') expect(r[1]).toBe(e.code); // mã của dòng dịch vụ: xem test riêng (phát hiện F-03)
      expect(r[2]).toBe(e.name);
      expect(typeof r[4]).toBe('number');
      expect(r[4]).toBe(e.qty);
      expect(r[5] ?? null).toBe(e.price);
      expect(r[6] ?? null).toBe(e.amount);
    });
    const sumRow = x.rows[h + 1 + LINES.length];
    expect(sumRow).toContain('Cộng');
    expect(sumRow[6]).toBe(3990000);
    expect(x.cells[h + 1 + LINES.length][6].formula || x.cells[h + 1 + LINES.length][6].value.formula).toMatch(/SUM/i);
    const od = findRow(x.rows, /^Nợ cũ/);
    expect(x.rows[od][6]).toBe(2000000);
    const td = findRow(x.rows, /^Tổng nợ/);
    expect(x.rows[td].find((v) => typeof v === 'string')).toContain('25/09/2026');
    expect(x.rows[td][6]).toBe(5990000);
  });

  test('REQ-073 REQ-074 REQ-087 Xuất Word: bảng thật 7 dòng + Cộng, Nợ cũ / Tổng nợ, tiếng Việt nguyên vẹn, không khóa', async () => {
    const { file, suggested } = await ui.exportDoc(page, 'docx', '03-phieu-ban.docx');
    files.docx = file;
    expect(suggested).toBe(`${docNo}.docx`);
    const d = await readDocx(file);
    expect(d.isProtected).toBe(false);
    expect(d.hasImages).toBe(false);
    const t = d.tables.find((tb) => tb[0] && tb[0].includes('Tên hàng'));
    expect(t, 'bảng dòng hàng').toBeTruthy();
    expect(t[0].slice(0, 7)).toEqual(['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền']);
    LINES.forEach((e, i) => {
      const r = t[1 + i];
      if (e.code !== 'DICHVU') expect(r[1]).toBe(e.code); // mã của dòng dịch vụ: xem test riêng (phát hiện F-03)
      expect(r[2]).toBe(e.name);
      expect(r[6]).toBe(e.amount === null ? '' : ui.money(e.amount));
    });
    expect(t[1 + LINES.length].join('|')).toContain('Cộng');
    expect(t[1 + LINES.length].join('|')).toContain('3.990.000');
    expect(d.allText).toContain(COMPANY.name);
    expect(d.allText).toContain('PHIẾU XUẤT KHO BÁN HÀNG');
    expect(d.paragraphs.join('\n') + d.tables.flat(2).join('\n')).toMatch(/Nợ cũ:\s*2\.000\.000/);
    expect(d.paragraphs.join('\n') + d.tables.flat(2).join('\n')).toMatch(/Tổng nợ \(đến ngày 25\/09\/2026\):\s*5\.990\.000/);
  });

  // PHÁT HIỆN F-03 (BAO_CAO_E2E.md): bản in ghi mã dòng dịch vụ là "DICHVU" đúng như mẫu phiếu của khách,
  // nhưng file Excel/Word (file gửi khách) lại ghi "DV" — cùng một phiếu, hai cách ghi.
  test.fail('REQ-047 REQ-087 Mã dòng dịch vụ trong file Excel/Word giống bản in và mẫu của khách ("DICHVU")', async () => {
    const x = await readXlsx(files.xlsx);
    const h = findRow(x.rows, /^Tên hàng$/);
    const d = await readDocx(files.docx);
    const t = d.tables.find((tb) => tb[0] && tb[0].includes('Tên hàng'));
    const xCodes = [x.rows[h + 6][1], x.rows[h + 7][1]];
    const dCodes = [t[6][1], t[7][1]];
    expect({ xlsx: xCodes, docx: dCodes }).toEqual({ xlsx: ['DICHVU', 'DICHVU'], docx: ['DICHVU', 'DICHVU'] });
  });
});
