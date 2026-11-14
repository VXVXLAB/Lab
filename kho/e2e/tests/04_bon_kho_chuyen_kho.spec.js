// Câu chuyện 4 — Bốn kho: tồn từng kho và tổng trên màn Tồn kho; chuyển kho nội bộ (kho xuất giảm, kho nhận tăng,
// tổng không đổi); lọc theo nhóm VTHH; tồn đến một ngày; xuất Excel toàn bộ mã.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, findRow } = require('../lib/files');

test.describe.configure({ mode: 'serial' });

const G = { group_code: 'CAP', group_name: 'Dây cáp hàn' };
const PRODUCTS = [
  { code: 'CAP25', name: 'Dây cáp hàn 25mm² (cuộn 100m)', unit: 'Cuộn', ...G, sale_price: 2500000, purchase_price: 2100000 },
  { code: 'CAP35', name: 'Dây cáp hàn 35mm² (cuộn 100m)', unit: 'Cuộn', ...G, sale_price: 3400000, purchase_price: 2900000 },
  { code: 'CAP50', name: 'Dây cáp hàn 50mm² (cuộn 100m)', unit: 'Cuộn', ...G, sale_price: 4600000, purchase_price: 3900000 },
  { code: 'KEMMASS', name: 'Kẹp mát 500A', unit: 'Cái', ...G, sale_price: 95000, purchase_price: 70000 },
];
// tồn đầu [KHO1, KHO2, KHO3, KHO4]
const OPEN = { CAP25: [20, 10, 0, 5], CAP35: [8, 0, 12, 0], CAP50: [0, 0, 0, 30] };

async function stockRows(page, waitFor) {
  const r = await ui.readReport(page, { waitFor });
  return Object.fromEntries(r.obj.map((x) => [x['Mã hàng'], x]));
}
const nums = (row) => ['KHO1', 'KHO2', 'KHO3', 'KHO4', 'Tổng tồn'].map((k) => ui.vnNum(row[k]));

test.describe('Câu chuyện 4: bốn kho, chuyển kho nội bộ, nhóm hàng, xuất Excel', () => {
  let page;
  let ctx;
  let ckNo;
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    for (const p of PRODUCTS) await api.ensureProduct(p);
    const whs = ['KHO1', 'KHO2', 'KHO3', 'KHO4'];
    for (let i = 0; i < 4; i++) {
      const lines = Object.entries(OPEN)
        .filter(([, q]) => q[i] > 0)
        .map(([code, q]) => ({ product_code: code, qty: q[i] }));
      if (lines.length) await api.openingStock(whs[i], '2026-01-01', lines);
    }
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    ({ ctx, page } = await openAs(browser, 'hoa', 'hoa123456', 'hoa'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-009 REQ-010 REQ-020 REQ-076 Tồn kho lọc nhóm "Dây cáp hàn": tồn 4 kho từng mã và tổng', async () => {
    await ui.menu(page, 'Kho', 'Tồn kho');
    await expect(page.getByRole('heading', { name: 'Tồn kho' })).toBeVisible();
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Nhóm hàng' }), /^CAP –/);
    const by = await stockRows(page, 'CAP50');
    // chỉ các mã của nhóm (mã chưa phát sinh bị ẩn khi "Chỉ mã có phát sinh")
    expect(Object.keys(by).sort()).toEqual(['CAP25', 'CAP35', 'CAP50']);
    expect(nums(by.CAP25)).toEqual([20, 10, 0, 5, 35]);
    expect(nums(by.CAP35)).toEqual([8, 0, 12, 0, 20]);
    expect(nums(by.CAP50)).toEqual([0, 0, 0, 30, 30]);
    const r = await ui.readReport(page);
    expect(r.sum['Mã hàng']).toBe('Cộng');
    expect(['KHO1', 'KHO2', 'KHO3', 'KHO4', 'Tổng tồn'].map((k) => ui.vnNum(r.sum[k]))).toEqual([28, 10, 12, 35, 85]);
    // bỏ chọn "Chỉ mã có phát sinh" ⇒ thêm mã chưa từng nhập (tồn 0)
    await page.getByRole('checkbox', { name: 'Chỉ mã có phát sinh' }).uncheck();
    const all = await stockRows(page, 'KEMMASS');
    expect(nums(all.KEMMASS)).toEqual([0, 0, 0, 0, 0]);
    await page.getByRole('checkbox', { name: 'Chỉ mã có phát sinh' }).check();
    await ui.shot(page, '04-ton-kho-nhom-cap');
  });

  test('REQ-011 REQ-077 Chuyển kho KHO1 → KHO3 qua giao diện (F2, F9)', async () => {
    await ui.menu(page, 'Kho', 'Chuyển kho');
    await ui.newDocByF2(page, /^Chuyển kho nội bộ/);
    await expect(page.getByRole('heading', { name: 'Phiếu chuyển kho' })).toBeVisible();
    await ui.setDocDate(page, '10/10/2026');
    await ui.pickWarehouse(page, 'KHO1');
    await ui.pickWarehouse(page, 'KHO3', '#to_warehouse');
    await ui.focusBlankCode(page);
    await ui.typeLine(page, { code: 'CAP25', qty: 15 }, { hasPrice: false });
    await ui.typeLine(page, { code: 'CAP35', qty: 8 }, { hasPrice: false });
    await expect(page.locator('.check-ok')).toContainText('Đủ hàng');
    ckNo = await ui.postDoc(page);
    expect(ckNo).toMatch(/^CK\d{5}$/);
    await ui.shot(page, '04-phieu-chuyen-kho');
  });

  test('REQ-011 REQ-077 REQ-009 Sau chuyển kho: KHO1 giảm, KHO3 tăng, tổng không đổi; xem tồn đến ngày trước đó', async () => {
    await ui.menu(page, 'Kho', 'Tồn kho');
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Nhóm hàng' }), /^CAP –/);
    let by = await stockRows(page, 'CAP50');
    expect(nums(by.CAP25)).toEqual([5, 10, 15, 5, 35]);
    expect(nums(by.CAP35)).toEqual([0, 0, 20, 0, 20]);
    // tồn đến 09/10/2026 (trước ngày chuyển) ⇒ như cũ
    const asOf = page.locator('.toolbar input[placeholder="dd/mm/yyyy"]');
    await asOf.fill('09/10/2026');
    await asOf.press('Enter');
    await expect(page.getByText('Tồn đến hết ngày 09/10/2026')).toBeVisible();
    by = await stockRows(page, 'CAP50');
    expect(nums(by.CAP25)).toEqual([20, 10, 0, 5, 35]);
    await ui.shot(page, '04-ton-kho-den-ngay');
  });

  test('REQ-010 Lọc một kho (KHO3) chỉ hiện cột kho đó', async () => {
    await page.reload();
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Nhóm hàng' }), /^CAP –/);
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Kho', exact: true }), /^KHO3 –/);
    const r = await ui.readReport(page, { waitFor: 'CAP35' });
    expect(r.headers).toContain('KHO3');
    expect(r.headers).not.toContain('KHO1');
    const by = Object.fromEntries(r.obj.map((x) => [x['Mã hàng'], x]));
    expect(ui.vnNum(by.CAP25.KHO3)).toBe(15);
    expect(ui.vnNum(by.CAP35.KHO3)).toBe(20);
  });

  test('REQ-011 REQ-002 Thẻ kho: từng kho thấy dòng chuyển kho, "Tất cả kho" ẩn dòng chuyển kho', async () => {
    await ui.menu(page, 'Kho', 'Thẻ kho / NXT');
    await ui.selectByTyping(page, page.locator('.toolbar .ant-select').first().getByRole('combobox'), 'CAP25', /CAP25/);
    await ui.setRange(page, page.locator('.toolbar'), '01/01/2026', '31/12/2026');
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Kho', exact: true }), /^KHO1 –/);
    let r = await ui.readReport(page, { waitFor: ckNo });
    let ck = r.obj.find((x) => x['Số chứng từ'] === ckNo);
    expect(ck['Diễn giải']).toMatch(/^Chuyển kho .*→/);
    expect([ui.vnNum(ck['Nhập']), ui.vnNum(ck['Xuất']), ui.vnNum(ck['Tồn'])]).toEqual([0, 15, 5]);
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Kho', exact: true }), /^KHO3 –/);
    r = await ui.readReport(page, { waitFor: ckNo });
    ck = r.obj.find((x) => x['Số chứng từ'] === ckNo);
    expect([ui.vnNum(ck['Nhập']), ui.vnNum(ck['Xuất']), ui.vnNum(ck['Tồn'])]).toEqual([15, 0, 15]);
    await ui.clearSelect(page.locator('.toolbar .ant-select:has([aria-label="Kho"])'));
    await expect(page.getByText('Xem tất cả kho: không hiện dòng chuyển kho nội bộ')).toBeVisible();
    r = await ui.readReport(page, { waitFor: 'Nhập tồn đầu kỳ' });
    expect(r.obj.find((x) => x['Số chứng từ'] === ckNo)).toBeUndefined();
    expect(r.sumCells.filter(Boolean).slice(-1)[0]).toBe('35');
  });

  test('REQ-031 Chuyển kho vượt tồn bị từ chối, nêu rõ mã thiếu', async () => {
    await ui.menu(page, 'Kho', 'Chuyển kho');
    await ui.newDocByF2(page, /^Chuyển kho nội bộ/);
    await ui.setDocDate(page, '11/10/2026');
    await ui.pickWarehouse(page, 'KHO1');
    await ui.pickWarehouse(page, 'KHO2', '#to_warehouse');
    await ui.focusBlankCode(page);
    await ui.typeLine(page, { code: 'CAP50', qty: 2 }, { hasPrice: false });
    await expect(page.locator('.row-short')).toContainText('Thiếu 2 — tồn 0');
    await page.keyboard.press('F9');
    const dlg = page.locator('.ant-modal-confirm').filter({ hasText: 'Không đủ hàng trong kho' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('CAP50');
    await expect(dlg).toContainText('thiếu 2');
    await dlg.getByRole('button', { name: 'Đã hiểu' }).click();
    await expect(page.getByText('PHIẾU TẠM — chưa ghi sổ', { exact: true })).toBeVisible();
    // dọn: xóa phiếu tạm
    await page.getByRole('button', { name: 'Xóa phiếu tạm' }).click();
    await page.locator('.ant-modal-confirm').getByRole('button', { name: 'Xóa phiếu' }).click();
    await expect(page.getByRole('heading', { name: /^Chuyển kho nội bộ/ })).toBeVisible();
  });

  test('REQ-022 REQ-075 REQ-063 Xuất Excel tồn kho toàn bộ mã: số dòng và tổng khớp màn hình', async () => {
    await ui.menu(page, 'Kho', 'Tồn kho');
    await page.getByRole('checkbox', { name: 'Chỉ mã có phát sinh' }).uncheck();
    const r = await ui.readReport(page, { waitFor: 'KEMMASS' });
    const { file } = await ui.download(page, () => page.getByRole('button', { name: 'Xuất Excel' }).click(), '04-ton-kho-toan-bo.xlsx');
    const x = await readXlsx(file);
    expect(x.isProtected).toBe(false);
    const h = findRow(x.rows, 'Tổng tồn');
    const head = x.rows[h].filter((v) => v !== null);
    expect(head.slice(0, 5)).toEqual(['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Nhóm VTHH']);
    expect(head.length).toBe(5 + 4 + 1);
    const data = [];
    for (let i = h + 1; i < x.rows.length; i++) {
      const row = x.rows[i];
      if (!row || row.every((v) => v === null)) continue;
      if (row.some((v) => typeof v === 'string' && /^Cộng/.test(v))) {
        // dòng tổng = tổng màn hình
        expect(row[row.length - 1]).toBe(ui.vnNum(r.sum['Tổng tồn']));
        expect(row.slice(5, 9)).toEqual(['KHO1', 'KHO2', 'KHO3', 'KHO4'].map((k) => ui.vnNum(r.sum[k])));
        break;
      }
      data.push(row);
    }
    expect(data.length).toBe(r.rows.length);
    for (const s of r.obj) {
      const xr = data.find((d) => d[1] === s['Mã hàng']);
      expect(xr, s['Mã hàng']).toBeTruthy();
      expect(xr[2]).toBe(s['Tên hàng']);
      expect(xr.slice(5, 10)).toEqual(['KHO1', 'KHO2', 'KHO3', 'KHO4', 'Tổng tồn'].map((k) => ui.vnNum(s[k])));
      for (const v of xr.slice(5, 10)) expect(typeof v).toBe('number');
    }
    // mã dịch vụ không bao giờ có trong tồn kho
    expect(data.find((d) => d[1] === 'DV')).toBeUndefined();
  });
});
