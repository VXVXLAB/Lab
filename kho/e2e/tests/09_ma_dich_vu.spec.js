// Câu chuyện 9 — Mã dịch vụ DV (YEU_CAU mục BÁN HÀNG 3, SPEC R7): dòng DV đơn giá dương (cộng), âm (trừ), để trống
// (ghi chú). Tổng phiếu và công nợ đổi theo; tồn kho không bao giờ đổi vì DV. Có cả trên phiếu nhập mua.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { KISWEL } = require('../lib/data');

test.describe.configure({ mode: 'serial' });

const P = { code: 'DAYMIG08', name: 'Dây hàn MIG 0.8mm (5kg)', unit: 'Cuộn', group_code: 'DH', group_name: 'Dây hàn', sale_price: 280000, purchase_price: 210000 };
const CUS = { code: 'NAMVIET', name: 'Công ty TNHH Cơ khí Nam Việt', is_customer: true, opening_receivable: 1000000 };

test.describe('Câu chuyện 9: mã dịch vụ DV', () => {
  let page;
  let ctx;
  let api;
  const s0 = {};
  test.beforeAll(async ({ browser }) => {
    api = await Api.login();
    await api.ensureProduct(P);
    await api.ensurePartner(CUS);
    await api.ensurePartner(KISWEL);
    await api.openingStock('KHO2', '2026-01-01', [{ product_code: P.code, qty: 30 }]);
    s0.stock = (await api.stockOf(P.code)).total_stock;
    s0.recv = await api.debtClosing('NAMVIET', 'receivable');
    s0.pay = await api.debtClosing('KISWEL', 'payable');
    s0.dvStock = await api.stockSummary({ q: 'DV', only_with_data: false });
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    ({ ctx, page } = await openAs(browser, 'hoa', 'hoa123456', 'hoa'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-047 REQ-048 REQ-049 REQ-050 Phiếu bán có dòng DV dương, âm và để trống; dòng ghi rõ cộng/trừ/ghi chú', async () => {
    await ui.enterDoc(page, {
      type: 'sale',
      date: '05/11/2026',
      partner: 'nam viet',
      partnerName: CUS.name,
      wh: 'KHO2',
      lines: [
        { code: P.code, qty: 4 },
        { code: 'DV', desc: 'CƯỚC XE GIAO HÀNG', price: '150000' },
        { code: 'dv', desc: 'CHIẾT KHẤU 5%', price: '-56000' },
        { code: 'DICHVU', desc: 'GIAO TRƯỚC 17H' },
      ],
      action: 'none',
    });
    const rows = page.locator('.line-grid tbody tr.row-service');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Dịch vụ — không tính tồn kho · cộng 150.000 vào tổng phiếu');
    await expect(rows.nth(1)).toContainText('trừ 56.000 vào tổng phiếu');
    await expect(rows.nth(2)).toContainText('dòng ghi chú (không tiền)');
    const l = await ui.readLines(page);
    expect(l.map((x) => [x.code, x.name, x.amount])).toEqual([
      [P.code, P.name, '1.120.000'],
      ['DV', 'CƯỚC XE GIAO HÀNG', '150.000'],
      ['DV', 'CHIẾT KHẤU 5%', '-56.000'],
      ['DV', 'GIAO TRƯỚC 17H', ''],
    ]);
    expect(await ui.footerSum(page, 'Cộng')).toBe(1120000 + 150000 - 56000);
    expect(await ui.footerSum(page, 'Tổng SL hàng')).toBe(4); // DV không tính vào SL hàng
    await ui.shot(page, '09-dong-dich-vu');
  });

  test('REQ-049 REQ-050 REQ-051 REQ-083 Ghi sổ: công nợ +1.214.000; tồn chỉ giảm 4 cuộn; DV không có tồn', async () => {
    const no = await ui.postDoc(page);
    expect(await ui.footerSum(page, 'Tổng nợ')).toBe(s0.recv + 1214000);
    expect(await api.debtClosing('NAMVIET', 'receivable')).toBe(s0.recv + 1214000);
    expect((await api.stockOf(P.code)).total_stock).toBe(s0.stock - 4);
    // màn Tồn kho không có mã DV dù bỏ "Chỉ mã có phát sinh"
    await ui.menu(page, 'Kho', 'Tồn kho');
    await page.getByRole('checkbox', { name: 'Chỉ mã có phát sinh' }).uncheck();
    const r = await ui.readReport(page, { waitFor: P.code });
    expect(r.obj.find((x) => x['Mã hàng'] === 'DV')).toBeUndefined();
    // sổ công nợ ghi đúng số tiền phiếu
    await ui.menu(page, 'Công nợ', 'Phải thu khách hàng');
    await page.getByRole('row', { name: /NAMVIET/ }).click();
    const dr = ui.topDrawer(page);
    const led = await ui.readReport(dr, { waitFor: no });
    const row = led.obj.find((x) => Object.values(x).includes(no));
    expect(ui.vnNum(row['Tăng'] ?? row['Phát sinh tăng'])).toBe(1214000);
    await page.keyboard.press('Escape');
  });

  test('REQ-047 REQ-051 Phiếu nhập mua có dòng DV "PHÍ VẬN CHUYỂN": công nợ NCC cộng thêm, tồn chỉ tăng hàng hóa', async () => {
    await ui.enterDoc(page, {
      type: 'purchase',
      date: '06/11/2026',
      partner: 'kiswel',
      partnerName: KISWEL.name,
      wh: 'KHO2',
      lines: [
        { code: P.code, qty: 10 },
        { code: 'DV', desc: 'PHÍ VẬN CHUYỂN', price: '200000' },
      ],
    });
    expect(await ui.footerSum(page, 'Cộng')).toBe(10 * 210000 + 200000);
    expect(await api.debtClosing('KISWEL', 'payable')).toBe(s0.pay + 2300000);
    expect((await api.stockOf(P.code)).total_stock).toBe(s0.stock - 4 + 10);
  });

  test('REQ-051 Phiếu chuyển kho / tồn đầu kỳ không nhận mã DV (không theo dõi NXT)', async () => {
    await ui.menu(page, 'Kho', 'Chuyển kho');
    await ui.newDocByF2(page, /^Chuyển kho nội bộ/);
    await ui.focusBlankCode(page);
    await page.keyboard.type('DV');
    await page.keyboard.press('Enter');
    await expect(page.locator('.product-dropdown')).toContainText('Không có mã hàng nào khớp "DV"');
    await page.keyboard.press('Escape');
  });
});
