// Câu chuyện 5 — Hết hàng: phiếu bán có mặt hàng không đủ tồn vẫn lưu tạm và in được dạng "PHIẾU TẠM (chưa ghi sổ)";
// Ghi sổ bị từ chối với thông báo rõ; mã thiếu hiện trong Mua hàng › Hàng cần đặt; lập phiếu nhập từ đó, ghi sổ;
// rồi phiếu bán tạm ghi sổ được. Ngày phiếu để mặc định (hôm nay) như kế toán làm thực tế.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, readDocx, findRow } = require('../lib/files');
const { DAIPHAT, SUNSHINE } = require('../lib/data');

test.describe.configure({ mode: 'serial' });

const P = { code: 'JASICMIG250', name: 'Máy hàn MIG Jasic 250A', unit: 'Cái', group_code: 'MAY', group_name: 'Máy hàn', sale_price: 9500000, purchase_price: 7800000 };

test.describe('Câu chuyện 5: hết hàng, phiếu tạm, hàng cần đặt', () => {
  let page;
  let ctx;
  let api;
  let tam;
  let saleUrl;
  let debt0;
  const after404 = [];
  test.beforeAll(async ({ browser }) => {
    api = await Api.login();
    await api.ensureProduct(P);
    await api.ensurePartner(DAIPHAT);
    await api.ensurePartner(SUNSHINE);
    await api.openingStock('KHO3', '2026-01-01', [{ product_code: P.code, qty: 6 }]);
    debt0 = await api.debtClosing('DAIPHAT', 'receivable');
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    ({ ctx, page } = await openAs(browser, 'lan', 'lan123456', 'lan'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-030 REQ-041 REQ-040 Gõ 10 máy khi KHO3 chỉ còn 6: dòng báo "Thiếu 4 — tồn 6", vẫn lưu tạm được', async () => {
    await ui.enterDoc(page, { type: 'sale', partner: 'dai phat', partnerName: DAIPHAT.name, wh: 'KHO3', lines: [{ code: P.code, qty: 10 }], action: 'none' });
    const row = page.locator('.line-grid tbody tr').filter({ hasText: P.name });
    await expect(row).toContainText('Thiếu 4 — tồn 6');
    await expect(page.locator('.check-bad')).toContainText('Chưa ghi sổ được — thiếu hàng');
    await expect(page.locator('.check-bad')).toContainText(`${P.code} tại Kho 3: tồn 6, cần 10, thiếu 4`);
    await ui.shot(page, '05-phieu-thieu-hang');
    tam = await ui.saveDraft(page);
    saleUrl = page.url();
    expect(await ui.footerSum(page, 'Cộng')).toBe(95000000);
  });

  test('REQ-005 REQ-032 In phiếu tạm: tiêu đề "PHIẾU TẠM (chưa ghi sổ)", có cảnh báo chưa phải phiếu chính thức', async () => {
    await ui.blurAll(page);
    await page.keyboard.press('Control+p');
    const dlg = page.getByRole('dialog', { name: 'Xem trước bản in — PHIẾU TẠM' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('alert')).toContainText('Phiếu chưa ghi sổ nên chỉ in được dạng PHIẾU TẠM');
    await expect(dlg.locator('.ps-title')).toHaveText('PHIẾU TẠM (chưa ghi sổ)');
    await expect(dlg.locator('.print-sheet')).not.toContainText('PHIẾU XUẤT KHO BÁN HÀNG');
    await expect(dlg.locator('.print-sheet')).toContainText(tam);
    await ui.shot(page, '05-in-phieu-tam');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('REQ-005 REQ-032 REQ-072 REQ-073 File Excel/Word của phiếu tạm cũng ghi "PHIẾU TẠM (chưa ghi sổ)"', async () => {
    const xf = await ui.exportDoc(page, 'xlsx', '05-phieu-tam.xlsx');
    expect(xf.suggested).toBe(`PHIEU_TAM_${tam}.xlsx`);
    const x = await readXlsx(xf.file);
    expect(findRow(x.rows, 'PHIẾU TẠM (chưa ghi sổ)')).toBeGreaterThanOrEqual(0);
    expect(findRow(x.rows, 'PHIẾU XUẤT KHO BÁN HÀNG')).toBe(-1);
    const df = await ui.exportDoc(page, 'docx', '05-phieu-tam.docx');
    const d = await readDocx(df.file);
    expect(d.allText).toContain('PHIẾU TẠM (chưa ghi sổ)');
    expect(d.allText).not.toContain('PHIẾU XUẤT KHO BÁN HÀNG');
  });

  test('REQ-031 REQ-079 Ghi sổ (F9) bị từ chối, nêu rõ mã nào thiếu bao nhiêu; phiếu vẫn là phiếu tạm; tồn và công nợ không đổi', async () => {
    await page.keyboard.press('F9');
    const dlg = page.locator('.ant-modal-confirm').filter({ hasText: 'Không đủ hàng trong kho' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText(`Mặt hàng ${P.code} - ${P.name} tại Kho 3`);
    await expect(dlg).toContainText('tồn 6, cần 10, thiếu 4');
    await expect(dlg).toContainText('Hàng cần đặt');
    await ui.shot(page, '05-tu-choi-ghi-so');
    await dlg.getByRole('button', { name: 'Đã hiểu' }).click();
    await expect(page.getByText('PHIẾU TẠM — chưa ghi sổ', { exact: true })).toBeVisible();
    expect((await api.stockOf(P.code)).total_stock).toBe(6);
    expect(await api.debtClosing('DAIPHAT', 'receivable')).toBe(debt0);
  });

  test('REQ-040 REQ-043 Phiếu hiện trong Bán hàng › Phiếu tạm đang treo, có người sửa cuối', async () => {
    await ui.menu(page, 'Bán hàng', 'Phiếu tạm đang treo');
    const row = page.getByRole('row', { name: new RegExp(tam) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(DAIPHAT.name);
    await expect(row).toContainText('Nguyễn Thị Lan');
  });

  test('REQ-046 Mua hàng › Hàng cần đặt: thiếu 4, bấm ▸ thấy phiếu tạm và khách, mở phiếu tại chỗ', async () => {
    await ui.menu(page, 'Mua hàng', 'Hàng cần đặt');
    await expect(page.getByRole('heading', { name: 'Hàng cần đặt' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(P.code) });
    await expect(row).toBeVisible();
    const cells = await row.locator('td').allInnerTexts();
    const t = cells.map((c) => c.trim());
    expect(t).toContain(P.name);
    // Khách cần | Tồn 4 kho | Thiếu, cần đặt | Phiếu tạm
    const idx = t.indexOf('Cái');
    expect(t.slice(idx + 1, idx + 5).map(ui.vnNum)).toEqual([10, 6, 4, 1]);
    await row.locator('.ant-table-row-expand-icon').click();
    const sub = page.locator('.sub-table tr').filter({ hasText: tam });
    await expect(sub).toContainText(DAIPHAT.name);
    await expect(sub).toContainText('10 Cái');
    await ui.shot(page, '05-hang-can-dat');
    await sub.click();
    await expect(ui.topDrawer(page)).toContainText(tam);
    await expect(ui.topDrawer(page)).toContainText(P.code);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
  });

  test('REQ-046 REQ-023 REQ-024 "Lập phiếu nhập" điền sẵn SL thiếu; chọn NCC, ghi sổ phiếu nhập', async () => {
    await page.getByRole('button', { name: /Lập phiếu nhập cho 1 mã thiếu/ }).click();
    await expect(page.getByRole('heading', { name: 'Phiếu nhập mua hàng' })).toBeVisible();
    await ui.toast(page, /Đã điền sẵn 1 mã thiếu/);
    const lines = await ui.readLines(page);
    expect(lines.length).toBe(1);
    expect(lines[0].code).toBe(P.code);
    expect(ui.vnNum(lines[0].qty)).toBe(4);
    expect(ui.vnNum(lines[0].price)).toBe(7800000);
    await expect(page.locator('#note')).toHaveValue(`Đặt hàng cho phiếu tạm ${tam}`);
    await ui.pickPartner(page, 'sunshine', SUNSHINE.name);
    await ui.pickWarehouse(page, 'KHO3');
    const nk = await ui.postDoc(page);
    expect(nk).toMatch(/^NK/);
    expect((await api.stockOf(P.code)).total_stock).toBe(10);
  });

  test('REQ-045 REQ-033 REQ-034 Hàng về: mở lại phiếu tạm, F9 ghi sổ được; tồn về 0; hết trong Hàng cần đặt', async () => {
    await ui.menu(page, 'Bán hàng', 'Phiếu tạm đang treo');
    await page.getByRole('row', { name: new RegExp(tam) }).dblclick();
    await expect(page).toHaveURL(saleUrl);
    await expect(page.locator('.check-ok')).toContainText('Đủ hàng — ghi sổ được');
    const xk = await ui.postDoc(page);
    expect(xk).toMatch(/^XK/);
    await expect(page.locator('.doc-no')).toContainText(`(số tạm ${tam})`);
    expect((await api.stockOf(P.code)).total_stock).toBe(0);
    expect(await api.debtClosing('DAIPHAT', 'receivable')).toBe(debt0 + 95000000);
    await ui.menu(page, 'Mua hàng', 'Hàng cần đặt');
    await expect(page.getByText('Không có mã nào thiếu hàng cho phiếu bán tạm.').or(page.getByRole('row', { name: /JASICMIG250/ }))).toBeVisible();
    await expect(page.getByRole('row', { name: /JASICMIG250/ })).toHaveCount(0);
  });

  test('REQ-031 REQ-079 Tồn = 0: phiếu bán 1 máy báo "Thiếu 1 — tồn 0" và không ghi sổ được', async () => {
    await ui.enterDoc(page, { type: 'sale', partner: 'dai phat', partnerName: DAIPHAT.name, wh: 'KHO3', lines: [{ code: P.code, qty: 1 }], action: 'none' });
    await expect(page.locator('.line-grid tbody tr').filter({ hasText: P.name })).toContainText('Thiếu 1 — tồn 0');
    await page.keyboard.press('F9');
    const dlg = page.locator('.ant-modal-confirm').filter({ hasText: 'Không đủ hàng trong kho' });
    await expect(dlg).toContainText('tồn 0, cần 1, thiếu 1');
    await dlg.getByRole('button', { name: 'Đã hiểu' }).click();
    // phiếu đã được lưu tạm khi bấm F9 (hướng dẫn: "Phiếu vẫn là phiếu tạm")
    await expect(page.getByText('PHIẾU TẠM — chưa ghi sổ', { exact: true })).toBeVisible();
  });

  test('REQ-040 Xóa phiếu tạm (nút thùng rác): hỏi lại, xóa xong về danh sách, phiếu không còn', async () => {
    const tamNo = (await page.locator('.doc-no b').first().innerText()).trim();
    const id = page.url().split('/').pop();
    page.on('response', (r) => {
      if (r.status() === 404 && new RegExp(`/api/documents/(${id}|check)$`).test(r.url())) after404.push(`${r.request().method()} ${r.url()}`);
    });
    await page.getByRole('button', { name: 'Xóa phiếu tạm' }).click();
    const conf = page.locator('.ant-modal-confirm').filter({ hasText: `Xóa phiếu tạm ${tamNo}?` });
    await expect(conf.getByRole('button', { name: 'Không xóa' })).toBeFocused(); // nút mặc định an toàn
    await conf.getByRole('button', { name: 'Xóa phiếu' }).click();
    await ui.toast(page, new RegExp(`Đã xóa phiếu tạm ${tamNo}`));
    await expect(page.getByRole('heading', { name: /^Phiếu bán hàng/ })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(tamNo) })).toHaveCount(0);
    // kiểm "không có lệnh gọi thừa" là kiểm sự VẮNG MẶT — không có sự kiện nào để chờ, nên chờ một khoảng ngắn cố định
    await page.waitForTimeout(800);
  });

  // PHÁT HIỆN F-06 (BAO_CAO_E2E.md): ngay sau khi xóa phiếu tạm, màn hình vẫn gọi lại máy chủ để tải phiếu vừa xóa và
  // kiểm tra tồn của nó ⇒ các phản hồi 404 thừa (Chrome in lỗi đỏ ra console). Người dùng không thấy, nhưng là lệnh gọi sai.
  test.fail('REQ-UX Sau khi xóa phiếu tạm không còn lệnh gọi nào tới phiếu đã xóa (không có 404)', async () => {
    expect(after404).toEqual([]);
  });
});
