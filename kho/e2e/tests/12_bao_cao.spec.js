// Câu chuyện 12 — Báo cáo (REQ-063…070, 086): chi tiết bán hàng, chi tiết mua hàng, lịch sử bán theo mặt hàng,
// tổng hợp nhập-xuất-tồn, tồn kho. Mỗi báo cáo: bấm dòng mở đúng phiếu ngay tại chỗ; Excel xuất ra khớp màn hình
// (số dòng và tổng). Dữ liệu tháng 8/2026 chuẩn bị qua API (chỉ là dữ liệu nền); mọi thao tác xem/mở/xuất qua giao diện.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, findRow } = require('../lib/files');

test.describe.configure({ mode: 'serial' });

const A = { code: 'E6013-25', name: 'Que hàn E6013 2.5mm (5kg)', unit: 'Hộp', group_code: 'QH', group_name: 'Que hàn', sale_price: 120000, purchase_price: 90000 };
const B = { code: 'E6013-32', name: 'Que hàn E6013 3.2mm (5kg)', unit: 'Hộp', group_code: 'QH', group_name: 'Que hàn', sale_price: 125000, purchase_price: 95000 };
const BINHAN = { code: 'BINHAN', name: 'Công ty TNHH Thương mại Bình An', is_customer: true };
const TRUONGPHAT = { code: 'TRUONGPHAT', name: 'Hộ kinh doanh Trường Phát', is_customer: true };
const DAIVIET = { code: 'DAIVIET', name: 'Công ty CP Que hàn Đại Việt', is_supplier: true };

/** Đọc file Excel báo cáo: dòng tiêu đề (có chuỗi `headerHas`), các dòng dữ liệu, dòng Cộng. */
function xlsxTable(x, headerHas) {
  const h = findRow(x.rows, headerHas);
  const header = x.rows[h];
  const data = [];
  let total = null;
  for (let i = h + 1; i < x.rows.length; i++) {
    const r = x.rows[i];
    if (!r || r.every((v) => v === null || v === '')) continue;
    if (r.some((v) => typeof v === 'string' && /^Cộng/.test(v))) {
      total = r;
      break;
    }
    data.push(r);
  }
  return { header, data, total, col: (name) => header.indexOf(name) };
}

test.describe('Câu chuyện 12: báo cáo, mở chi tiết và xuất Excel', () => {
  let page;
  let ctx;
  const no = {};
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    for (const p of [A, B]) await api.ensureProduct(p);
    for (const p of [BINHAN, TRUONGPHAT, DAIVIET]) await api.ensurePartner(p);
    const kho2 = await api.wh('KHO2');
    const id = async (c) => (await api.findByCode('partners', c)).id;
    const doc = (doc_type, date, partner, lines) => api.postedDoc({ doc_type, doc_date: date, partner_id: partner, warehouse_id: kho2.id, lines });
    no.nk = (await doc('purchase', '2026-08-03', await id('DAIVIET'), [{ product_code: A.code, qty: 100, unit_price: 90000 }, { product_code: B.code, qty: 80, unit_price: 95000 }])).doc_no;
    no.x1 = (await doc('sale', '2026-08-10', await id('BINHAN'), [{ product_code: A.code, qty: 20, unit_price: 120000 }, { product_code: B.code, qty: 10, unit_price: 125000 }])).doc_no;
    no.x2 = (await doc('sale', '2026-08-15', await id('TRUONGPHAT'), [{ product_code: A.code, qty: 15, unit_price: 118000 }])).doc_no;
    no.x3 = (await doc('sale', '2026-08-20', await id('BINHAN'), [{ product_code: B.code, qty: 5, unit_price: 125000 }])).doc_no;
    no.r1 = (await doc('sale_return', '2026-08-22', await id('TRUONGPHAT'), [{ product_code: A.code, qty: 2, unit_price: 118000 }])).doc_no;
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    ({ ctx, page } = await openAs(browser, 'lan', 'lan123456', 'lan'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-067 REQ-070 Chi tiết bán hàng tháng 8: 4 dòng, tổng SL 50, tổng tiền 6.045.000; bấm dòng mở đúng phiếu', async () => {
    await ui.menu(page, 'Báo cáo');
    await page.getByRole('button', { name: /Chi tiết bán hàng/ }).click();
    await expect(page.getByRole('heading', { name: 'Chi tiết bán hàng' })).toBeVisible();
    await ui.setRange(page, page.locator('.toolbar'), '01/08/2026', '31/08/2026');
    const r = await ui.readReport(page, { waitFor: no.x3 });
    expect(r.rows.length).toBe(4);
    expect(r.obj.map((x) => [x['Số phiếu'], x['Khách hàng'], x['Mã hàng'], ui.vnNum(x.SL), ui.vnNum(x['Thành tiền'])])).toEqual([
      [no.x1, BINHAN.name, A.code, 20, 2400000],
      [no.x1, BINHAN.name, B.code, 10, 1250000],
      [no.x2, TRUONGPHAT.name, A.code, 15, 1770000],
      [no.x3, BINHAN.name, B.code, 5, 625000],
    ]);
    expect(r.sumCells).toContain('3 phiếu');
    expect(ui.vnNum(r.sum.SL)).toBe(50);
    expect(ui.vnNum(r.sum['Thành tiền'])).toBe(6045000);
    await page.locator('.report-table .ant-table-tbody tr.ant-table-row').nth(2).click();
    const dr = ui.topDrawer(page);
    await expect(dr).toContainText(`Phiếu bán hàng ${no.x2}`);
    await expect(dr).toContainText(TRUONGPHAT.name);
    await expect(dr).toContainText('118.000');
    await ui.shot(page, '12-chi-tiet-ban-hang-mo-phieu');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
    // gồm khách trả hàng: thêm 1 dòng âm
    await page.getByRole('checkbox', { name: 'Gồm khách trả hàng' }).check();
    const r2 = await ui.readReport(page, { waitFor: no.r1 });
    const ret = r2.obj.find((x) => x['Số phiếu'] === no.r1);
    expect(ui.vnNum(ret.SL)).toBe(-2);
    expect(ui.vnNum(r2.sum['Thành tiền'])).toBe(6045000 - 236000);
    await page.getByRole('checkbox', { name: 'Gồm khách trả hàng' }).uncheck();
  });

  test('REQ-067 REQ-087 Excel chi tiết bán hàng khớp màn hình: 4 dòng, SL 50, tiền 6.045.000, ô số thật', async () => {
    const r = await ui.readReport(page, { waitFor: no.x3 });
    expect(r.rows.length).toBe(4);
    const { file } = await ui.download(page, () => page.getByRole('button', { name: 'Xuất Excel' }).click(), '12-chi-tiet-ban-hang.xlsx');
    const x = await readXlsx(file);
    expect(x.isProtected).toBe(false);
    const t = xlsxTable(x, 'Thành tiền');
    expect(t.data.length).toBe(r.rows.length);
    const amt = t.col('Thành tiền');
    expect(t.data.map((d) => d[amt])).toEqual([2400000, 1250000, 1770000, 625000]);
    expect(t.total[amt]).toBe(6045000);
    expect(t.total.filter((v) => typeof v === 'number')).toContain(50);
    expect(t.data.map((d) => d.find((v) => v === BINHAN.name || v === TRUONGPHAT.name))).toEqual([BINHAN.name, BINHAN.name, TRUONGPHAT.name, BINHAN.name]);
  });

  test('REQ-066 REQ-070 Chi tiết mua hàng tháng 8: 2 dòng 16.600.000; mở phiếu nhập tại chỗ; Excel khớp', async () => {
    await ui.menu(page, 'Báo cáo');
    await page.getByRole('button', { name: /Chi tiết mua hàng/ }).click();
    await expect(page.getByRole('heading', { name: 'Chi tiết mua hàng' })).toBeVisible();
    await ui.setRange(page, page.locator('.toolbar'), '01/08/2026', '31/08/2026');
    const r = await ui.readReport(page, { waitFor: no.nk });
    expect(r.obj.map((x) => [x['Số phiếu'], x['Nhà cung cấp'], x['Mã hàng'], ui.vnNum(x['Đơn giá']), ui.vnNum(x['Thành tiền'])])).toEqual([
      [no.nk, DAIVIET.name, A.code, 90000, 9000000],
      [no.nk, DAIVIET.name, B.code, 95000, 7600000],
    ]);
    expect(ui.vnNum(r.sum['Thành tiền'])).toBe(16600000);
    await page.locator('.report-table .ant-table-tbody tr.ant-table-row').first().click();
    await expect(ui.topDrawer(page)).toContainText(`Phiếu nhập mua hàng ${no.nk}`);
    await page.keyboard.press('Escape');
    const { file } = await ui.download(page, () => page.getByRole('button', { name: 'Xuất Excel' }).click(), '12-chi-tiet-mua-hang.xlsx');
    const t = xlsxTable(await readXlsx(file), 'Thành tiền');
    expect(t.data.length).toBe(2);
    expect(t.total[t.col('Thành tiền')]).toBe(16600000);
  });

  test('REQ-021 REQ-070 Lịch sử bán theo mặt hàng: E6013 2.5mm bán cho ai, ngày nào, giá bao nhiêu', async () => {
    await ui.menu(page, 'Báo cáo');
    await page.getByRole('button', { name: /Lịch sử bán theo mặt hàng/ }).click();
    await expect(page.getByRole('heading', { name: 'Lịch sử bán hàng theo mặt hàng' })).toBeVisible();
    await ui.selectByTyping(page, page.locator('.toolbar .ant-select').filter({ hasText: 'Mặt hàng…' }).getByRole('combobox'), 'E6013-25', /E6013-25 –/);
    const r = await ui.readReport(page, { waitFor: no.x2 });
    expect(r.obj.map((x) => [x['Ngày'], x['Số phiếu'], x['Khách hàng'], ui.vnNum(x.SL), ui.vnNum(x['Đơn giá'])])).toEqual([
      ['10/08/2026', no.x1, BINHAN.name, 20, 120000],
      ['15/08/2026', no.x2, TRUONGPHAT.name, 15, 118000],
    ]);
    await ui.shot(page, '12-lich-su-ban-mat-hang');
    await page.locator('.report-table .ant-table-tbody tr.ant-table-row').filter({ hasText: no.x1 }).click();
    await expect(ui.topDrawer(page)).toContainText(no.x1);
    await page.keyboard.press('Escape');
  });

  test('REQ-021 Từ danh mục hàng hóa: nút "Lịch sử bán" mở lịch sử ngay tại chỗ', async () => {
    await ui.menu(page, 'Danh mục', 'Hàng hóa, dịch vụ');
    await page.getByPlaceholder(/Tìm mã, tên hàng/).fill('E6013-25');
    const row = page.getByRole('row', { name: /E6013-25/ });
    await row.getByRole('button', { name: 'Lịch sử bán' }).click();
    const dr = ui.topDrawer(page);
    await expect(dr).toContainText(`Lịch sử bán — E6013-25 ${A.name}`);
    const r = await ui.readReport(dr, { waitFor: no.x2 });
    expect(r.rows.length).toBe(2);
    await page.keyboard.press('Escape');
  });

  test('REQ-064 REQ-068 Tổng hợp NXT tháng 8: tồn đầu/nhập/xuất/tồn cuối; bấm mã mở thẻ kho đúng kỳ; Excel khớp', async () => {
    await ui.menu(page, 'Kho', 'Tổng hợp NXT');
    await ui.setRange(page, page.locator('.toolbar'), '01/08/2026', '31/08/2026');
    await page.getByPlaceholder('Tìm mã, tên hàng…').fill('E6013');
    await expect(page.locator('.report-table .ant-table-tbody tr.ant-table-row')).toHaveCount(2); // lọc xong
    const r = await ui.readReport(page, { waitFor: B.code });
    const by = Object.fromEntries(r.obj.map((x) => [x['Mã hàng'], ['Tồn đầu kỳ', 'Nhập', 'Xuất', 'Tồn cuối kỳ'].map((k) => ui.vnNum(x[k]))]));
    expect(by[A.code]).toEqual([0, 102, 35, 67]);
    expect(by[B.code]).toEqual([0, 80, 15, 65]);
    expect(r.rows.length).toBe(2);
    await page.locator('.report-table .ant-table-tbody tr.ant-table-row').filter({ hasText: A.code }).click();
    const dr = ui.topDrawer(page);
    await expect(dr).toContainText(`Thẻ kho — ${A.code}`);
    const led = await ui.readReport(dr, { waitFor: no.r1 });
    expect(led.obj.filter((x) => x['Số chứng từ']).map((x) => x['Số chứng từ'])).toEqual([no.nk, no.x1, no.x2, no.r1]);
    expect(led.obj.find((x) => x['Số chứng từ'] === no.r1)['Diễn giải']).toBe(`${TRUONGPHAT.name} - trả hàng`);
    // tầng 3: bấm dòng thẻ kho mở phiếu
    await dr.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: no.x2 }).click();
    await expect(ui.topDrawer(page)).toContainText(`Phiếu bán hàng ${no.x2}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
    const { file } = await ui.download(page, () => page.getByRole('button', { name: 'Xuất Excel' }).click(), '12-tong-hop-nxt.xlsx');
    const t = xlsxTable(await readXlsx(file), 'Tồn cuối kỳ');
    expect(t.data.length).toBe(2);
    const rowA = t.data.find((d) => d.includes(A.code));
    expect(['Tồn đầu kỳ', 'Nhập', 'Xuất', 'Tồn cuối kỳ'].map((k) => rowA[t.col(k)] ?? 0)).toEqual([0, 102, 35, 67]);
    expect(t.total[t.col('Tồn cuối kỳ')]).toBe(132);
  });

  test('REQ-063 REQ-068 Tồn kho: bấm số tồn của một kho mở thẻ kho kho đó ngay tại chỗ', async () => {
    await ui.menu(page, 'Kho', 'Tồn kho');
    await page.getByPlaceholder('Tìm mã, tên hàng…').fill('E6013');
    await ui.readReport(page, { waitFor: B.code });
    const row = page.locator('.report-table .ant-table-tbody tr.ant-table-row').filter({ hasText: B.code });
    // cột KHO2 là cột thứ 6 (Mã, Tên, ĐVT, Nhóm, KHO1, KHO2…)
    await row.locator('td').nth(5).locator('.qty-link').click();
    const dr = ui.topDrawer(page);
    await expect(dr).toContainText(`Thẻ kho — ${B.code}`);
    await expect(dr.locator('.ant-select:has([aria-label="Kho"]) .ant-select-selection-item')).toContainText('KHO2');
    const led = await ui.readReport(dr, { waitFor: no.x3 });
    expect(led.sumCells.filter(Boolean).slice(-1)[0]).toBe('65');
    await ui.shot(page, '12-ton-kho-mo-the-kho');
    await page.keyboard.press('Escape');
  });
});
