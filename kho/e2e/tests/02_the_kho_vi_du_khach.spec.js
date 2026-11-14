// Câu chuyện 2 — Ví dụ thẻ kho của khách (YEU_CAU_PHAN_MEM.txt mục KHO 2):
// WW829HT107k tồn đầu 27; bán 4 và 3 cho CTY TNHH TM DV VĨNH PHONG; CHÚ NGỌC MINH trả 1; bán 1 cho
// CÔNG TY TNHH NHỰA PHẠM GIA (Phường Bình Hưng Hòa B). Nhập hoàn toàn qua giao diện, đúng ngày của tài liệu,
// rồi đọc lại màn Thẻ kho từng dòng và file Excel xuất ra.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, findRow } = require('../lib/files');

test.describe.configure({ mode: 'serial' });

const P = { code: 'WW829HT107k', name: 'Dây hàn lõi thuốc WW829 1.2mm (15kg)', unit: 'Cuộn', group_code: 'DH', group_name: 'Dây hàn', sale_price: 820000, purchase_price: 650000 };
const VP = 'CTY TNHH TM DV VĨNH PHONG';
const NM = 'CHÚ NGỌC MINH';
const PG = 'CÔNG TY TNHH NHỰA PHẠM GIA';

test.describe('Câu chuyện 2: thẻ kho WW829HT107k theo ví dụ của khách', () => {
  let page;
  let ctx;
  const no = {};
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    await api.ensureProduct(P);
    await api.ensurePartner({ code: 'VINHPHONG', name: VP, is_customer: true, address: '123 Lũy Bán Bích, Tân Phú' });
    await api.ensurePartner({ code: 'NGOCMINH', name: NM, is_customer: true });
    await api.ensurePartner({ code: 'PHAMGIA', name: PG, is_customer: true, address: 'Phường Bình Hưng Hòa B, Bình Tân' });
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    ({ ctx, page } = await openAs(browser, 'lan', 'lan123456', 'lan'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-013 REQ-024 Tồn đầu kỳ 27 cuộn tại KHO1 (01/01/2026)', async () => {
    no.opening = await ui.enterDoc(page, { type: 'opening', date: '01/01/2026', wh: 'KHO1', lines: [{ code: P.code, qty: 27 }] });
    expect(no.opening).toMatch(/^TDK/);
  });

  test('REQ-025 REQ-033 REQ-017 Bán 4 cuộn (03/04/2026) và 3 cuộn (14/04/2026) cho VĨNH PHONG', async () => {
    no.s1 = await ui.enterDoc(page, { type: 'sale', date: '03/04/2026', partner: 'vinh phong', partnerName: VP, wh: 'KHO1', lines: [{ code: P.code, qty: 4 }] });
    no.s2 = await ui.enterDoc(page, { type: 'sale', date: '14/04/2026', partner: 'vinh phong', partnerName: VP, wh: 'KHO1', lines: [{ code: P.code, qty: 3 }] });
    expect(no.s1).toMatch(/^XK\d{5}$/);
    expect(no.s2).toMatch(/^XK\d{5}$/);
  });

  test('REQ-018 CHÚ NGỌC MINH trả lại 1 cuộn (17/04/2026) — Bán hàng › Khách trả hàng', async () => {
    no.r1 = await ui.enterDoc(page, { type: 'sale_return', date: '17/04/2026', partner: 'ngoc minh', partnerName: NM, wh: 'KHO1', lines: [{ code: P.code, qty: 1 }] });
    expect(no.r1).toMatch(/^NK\d{5}$/);
  });

  test('REQ-017 Bán 1 cuộn cho NHỰA PHẠM GIA (26/05/2026), ghi chú "Phường Bình Hưng Hòa B"', async () => {
    no.s3 = await ui.enterDoc(page, {
      type: 'sale',
      date: '26/05/2026',
      partner: 'pham gia',
      partnerName: PG,
      wh: 'KHO1',
      note: 'Phường Bình Hưng Hòa B',
      lines: [{ code: P.code, qty: 1 }],
    });
  });

  const expected = () => [
    // [ngày, số CT, diễn giải, nhập, xuất, tồn]
    ['03/04/2026', no.s1, `Xuất kho bán hàng ${VP}`, 0, 4, 23],
    ['14/04/2026', no.s2, `Xuất kho bán hàng ${VP}`, 0, 3, 20],
    ['17/04/2026', no.r1, `${NM} - trả hàng`, 1, 0, 21],
    ['26/05/2026', no.s3, `Xuất kho bán hàng ${PG} - Phường Bình Hưng Hòa B`, 0, 1, 20],
  ];

  test('REQ-002 REQ-012 REQ-014 REQ-015 REQ-017 REQ-018 REQ-078 Thẻ kho đọc lại đúng từng dòng như mẫu của khách', async () => {
    await ui.menu(page, 'Kho', 'Thẻ kho / NXT');
    await expect(page.getByRole('heading', { name: 'Thẻ kho — chi tiết nhập xuất tồn' })).toBeVisible();
    await ui.selectByTyping(page, page.locator('.toolbar .ant-select').first().getByRole('combobox'), 'WW829', /WW829HT107k/);
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Kho', exact: true }), /^KHO1 –/);
    await ui.setRange(page, page.locator('.toolbar'), '01/04/2026', '31/05/2026');
    const r = await ui.readReport(page, { waitFor: no.s3 });
    expect(r.headers).toEqual(['Mã hàng', 'Ngày hạch toán', 'Số chứng từ', 'Diễn giải', 'ĐVT', 'Nhập', 'Xuất', 'Tồn']);
    // dòng đầu: số dư đầu kỳ
    expect(r.rows[0]).toEqual(['WW829HT107k', '', '', 'Số dư đầu kỳ', 'Cuộn', '-', '-', '27']);
    const exp = expected();
    expect(r.rows.length).toBe(1 + exp.length);
    exp.forEach((e, i) => {
      const row = r.rows[i + 1];
      expect(row[0]).toBe('WW829HT107k');
      expect([row[1], row[2], row[3]]).toEqual([e[0], e[1], e[2]]);
      expect(row[4]).toBe('Cuộn');
      expect([ui.vnNum(row[5]), ui.vnNum(row[6]), ui.vnNum(row[7])]).toEqual([e[3], e[4], e[5]]);
    });
    // dòng tổng: nhập 1, xuất 8, tồn 20
    const s = r.sumCells.filter((x) => x !== '');
    expect(s).toEqual(['Cộng', '1', '8', '20']);
    await ui.shot(page, '02-the-kho-WW829HT107k');
  });

  test('REQ-019 Lọc thời gian: 01/04–15/04/2026 chỉ còn 2 lần bán, tồn cuối 20; xem "Tất cả kho" có cột Kho', async () => {
    await ui.setRange(page, page.locator('.toolbar'), '01/04/2026', '15/04/2026');
    let r = await ui.readReport(page, { waitFor: no.s2 });
    await expect(page.locator('.report-table .ant-table-tbody tr.ant-table-row')).toHaveCount(3);
    r = await ui.readReport(page);
    expect(r.rows.map((x) => x[2])).toEqual(['', no.s1, no.s2]);
    expect(r.sumCells.filter((x) => x !== '')).toEqual(['Cộng', '0', '7', '20']);
    // bỏ lọc kho ⇒ "Tất cả kho"
    await ui.clearSelect(page.locator('.toolbar .ant-select:has([aria-label="Kho"])'));
    await expect(page.getByText('Xem tất cả kho: không hiện dòng chuyển kho nội bộ')).toBeVisible();
    r = await ui.readReport(page, { waitFor: no.s2 });
    expect(r.headers).toContain('Kho');
    expect(r.obj.filter((x) => x['Số chứng từ']).every((x) => x.Kho === 'KHO1')).toBe(true);
  });

  test('REQ-068 REQ-086 Bấm một dòng thẻ kho mở đúng phiếu ngay tại chỗ, Esc đóng, vẫn ở màn Thẻ kho', async () => {
    const url = page.url();
    await page.locator('.report-table .ant-table-tbody tr.ant-table-row').filter({ hasText: no.s1 }).click();
    const dr = ui.topDrawer(page);
    await expect(dr).toContainText(`Phiếu bán hàng ${no.s1}`);
    await expect(dr).toContainText(VP);
    await expect(dr).toContainText('03/04/2026');
    await expect(dr.getByRole('row', { name: /WW829HT107k/ })).toContainText('4,0');
    await ui.shot(page, '02-the-kho-mo-phieu');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
    expect(page.url()).toBe(url);
  });

  test('REQ-002 REQ-008 Xuất Excel thẻ kho đúng mẫu của khách (01/04–31/05/2026, KHO1)', async () => {
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Kho', exact: true }), /^KHO1 –/);
    await ui.setRange(page, page.locator('.toolbar'), '01/04/2026', '31/05/2026');
    await ui.readReport(page, { waitFor: no.s3 });
    const { file } = await ui.download(page, () => page.getByRole('button', { name: 'Xuất Excel' }).click(), '02-the-kho-WW829HT107k.xlsx');
    const x = await readXlsx(file);
    expect(x.isProtected).toBe(false);
    const h = findRow(x.rows, 'Ngày hạch toán');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(x.rows[h].filter((v) => v !== null)).toEqual(['Mã hàng', 'Ngày hạch toán', 'Số chứng từ', 'Diễn giải', 'ĐVT', 'Nhập', 'Xuất', 'Tồn']);
    const op = x.rows[h + 1];
    expect(op).toContain('Số dư đầu kỳ');
    expect(op[op.length - 1]).toBe(27);
    const exp = expected();
    exp.forEach((e, i) => {
      const row = x.rows[h + 2 + i];
      expect(row[0]).toBe('WW829HT107k');
      const dateCell = row[1] instanceof Date ? row[1].toISOString().slice(0, 10).split('-').reverse().join('/') : row[1];
      expect(dateCell).toBe(e[0]);
      expect(row[2]).toBe(e[1]);
      expect(row[3]).toBe(e[2]);
      expect(row[4]).toBe('Cuộn');
      // Nhập/Xuất/Tồn là ô số thật (ô trống hoặc "-" khi bằng 0)
      const n = (v) => (v === null || v === '-' || v === '' ? 0 : v);
      expect(typeof row[7]).toBe('number');
      expect([n(row[5]), n(row[6]), row[7]]).toEqual([e[3], e[4], e[5]]);
    });
    const tot = x.rows[h + 2 + exp.length];
    expect(tot.some((v) => typeof v === 'string' && /Cộng/.test(v))).toBe(true);
    expect(tot.slice(5, 8)).toEqual([1, 8, 20]);
  });

  test('REQ-012 Đối chiếu API: thẻ kho trên màn hình = số liệu máy chủ', async () => {
    const api = await Api.login();
    const p = await api.findByCode('products', P.code);
    const kho1 = await api.wh('KHO1');
    const l = await api.get(`/reports/stock-ledger?product_id=${p.id}&from=2026-04-01&to=2026-05-31&warehouse_id=${kho1.id}`);
    expect([l.opening, l.total_in, l.total_out, l.closing]).toEqual([27, 1, 8, 20]);
  });
});
