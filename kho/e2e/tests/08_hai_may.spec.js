// Câu chuyện 8 — Hai máy (YEU_CAU mục 4 cuối, REQ-040…045, 082): máy 1 lên phiếu tạm; máy 2 thấy ngay trong
// "Phiếu tạm đang treo" mà không tải lại trang, mở, thêm dòng; máy 1 thấy thay đổi; hai máy sửa cùng lúc ⇒
// báo xung đột, không mất dòng đang gõ; máy 2 ghi sổ. Hai ngữ cảnh trình duyệt riêng, hai kế toán khác nhau.
// Vòng kiểm lại F-01: hai máy cùng thêm / sửa / xóa dòng (phiếu kho và phiếu thu); khung vàng chỉ được liệt kê thay đổi
// của máy mình; "Thêm các dòng này vào phiếu" phải gộp không lặp dòng và giữ phần máy kia đã sửa.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');

test.describe.configure({ mode: 'serial' });

const CUS = { code: 'HOANGLONG', name: 'Cửa hàng VLXD Hoàng Long', is_customer: true, phone: '0918 222 333' };
const PRODUCTS = [
  { code: 'MATNA', name: 'Mặt nạ hàn tự động', unit: 'Cái', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 350000, purchase_price: 250000 },
  { code: 'GANGTAY', name: 'Găng tay hàn da', unit: 'Đôi', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 45000, purchase_price: 30000 },
  { code: 'BUAGO', name: 'Búa gõ xỉ hàn', unit: 'Cái', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 35000, purchase_price: 22000 },
  { code: 'KINHBH', name: 'Kính bảo hộ hàn', unit: 'Cái', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 60000, purchase_price: 40000 },
  { code: 'XITHAN', name: 'Bình xịt chống dính hàn', unit: 'Bình', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 85000, purchase_price: 60000 },
];

const linesOf = async (page) => (await ui.readLines(page)).map((l) => `${l.code}:${ui.vnNum(l.qty)}`);
const linesWithPrice = async (page) => (await ui.readLines(page)).map((l) => `${l.code}:${ui.vnNum(l.qty)}@${ui.vnNum(l.price)}`);
const rowOf = (page, name) => page.locator('.line-grid tbody tr').filter({ hasText: name });
/** Sửa ô SL / Đơn giá của dòng có tên hàng `name` (nth: dòng thứ mấy trong các dòng cùng tên). */
async function setCell(page, name, col, value, nth = 0) {
  const row = rowOf(page, name).nth(nth);
  await row.locator(`[data-cell$=":${col}"]`).click();
  await ui.focused(page, `[data-cell$=":${col}"]`);
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Tab');
}
async function deleteRow(page, name) {
  const n = await rowOf(page, name).count();
  await rowOf(page, name).first().locator('input.code-input').click();
  await page.keyboard.press('Control+Delete');
  await expect(rowOf(page, name)).toHaveCount(n - 1);
}
/** Máy 1 đang có thay đổi chưa lưu ⇒ Ctrl+S ⇒ "Máy khác vừa sửa phiếu này" ⇒ Tải bản mới; trả khung vàng. */
async function conflictReload(page) {
  await expect(page.locator('.doc-alert').filter({ hasText: /Phiếu vừa được Trần Thị Hoa \(Máy 2\) sửa lúc/ })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Control+s');
  const dlg = page.locator('.ant-modal-confirm').filter({ hasText: 'Máy khác vừa sửa phiếu này' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Tải bản mới' }).click();
  await expect(dlg).toBeHidden();
  const stash = page.locator('.doc-alert').filter({ hasText: 'Các dòng bạn đã nhập trước khi tải bản mới' });
  await expect(stash).toBeVisible();
  return stash;
}
/** Bảng trong khung vàng: [nhãn, mã, tên, SL, giá] mỗi thay đổi. */
async function stashRows(stash) {
  return stash.locator('.stash-table tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim())));
}

test.describe('Câu chuyện 8: hai máy cùng làm một phiếu tạm', () => {
  let m1; // Nguyễn Thị Lan (Máy 1)
  let m2; // Trần Thị Hoa (Máy 2)
  let tam;
  let docUrl;
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    await api.ensurePartner(CUS);
    for (const p of PRODUCTS) await api.ensureProduct(p);
    await api.openingStock('KHO1', '2026-01-01', PRODUCTS.map((p) => ({ product_code: p.code, qty: 50 })));
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    m1 = await openAs(browser, 'lan', 'lan123456', 'máy 1 (lan)');
    m2 = await openAs(browser, 'hoa', 'hoa123456', 'máy 2 (hoa)');
  });
  test.afterAll(async () => {
    await m1.ctx.close();
    await m2.ctx.close();
  });

  test('REQ-040 REQ-042 REQ-043 REQ-082 Máy 1 lưu phiếu tạm; máy 2 đang mở "Phiếu tạm đang treo" thấy ngay, không tải lại trang', async () => {
    await ui.menu(m2.page, 'Bán hàng', 'Phiếu tạm đang treo');
    await expect(m2.page.getByRole('heading', { name: /Phiếu tạm/ })).toBeVisible();
    await m2.page.evaluate(() => (window.__chuaTaiLai = true));

    tam = await ui.enterDoc(m1.page, { type: 'sale', partner: 'hoang long', partnerName: CUS.name, wh: 'KHO1', lines: [{ code: 'MATNA', qty: 2 }], action: 'save' });
    docUrl = m1.page.url();

    const row = m2.page.getByRole('row', { name: new RegExp(tam) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(CUS.name);
    await expect(row).toContainText('Nguyễn Thị Lan (Máy 1)');
    expect(await m2.page.evaluate(() => window.__chuaTaiLai)).toBe(true);
    await ui.shot(m2.page, '08-may2-thay-phieu-tam');
  });

  test('REQ-044 REQ-082 Máy 2 mở phiếu của máy 1, thêm dòng, lưu; máy 1 (chưa sửa gì) tự hiện bản mới', async () => {
    await m2.page.getByRole('row', { name: new RegExp(tam) }).dblclick();
    await expect(m2.page).toHaveURL(docUrl);
    await expect(m2.page.locator('.doc-meta')).toContainText('Lập: Nguyễn Thị Lan (Máy 1)');
    // con trỏ tự vào ô mã của dòng trống cuối để gõ tiếp
    await expect(m2.page.locator('input.code-input').last()).toBeFocused();
    await ui.typeLine(m2.page, { code: 'GANGTAY', qty: 10 });
    await ui.typeLine(m2.page, { code: 'BUAGO', qty: 5 });
    await ui.saveDraft(m2.page);

    await ui.toast(m1.page, /Phiếu vừa được Trần Thị Hoa \(Máy 2\) cập nhật lúc .* — đã hiện bản mới nhất/);
    await expect.poll(() => linesOf(m1.page)).toEqual(['MATNA:2', 'GANGTAY:10', 'BUAGO:5']);
    await expect(m1.page.locator('.doc-meta')).toContainText('Sửa lần cuối: Trần Thị Hoa (Máy 2)');
    await ui.shot(m1.page, '08-may1-thay-thay-doi');
  });


  test('REQ-044 REQ-082 F-01 vòng 1: máy 1 sửa SL MATNA, xóa BUAGO, thêm KINHBH (chưa lưu); máy 2 sửa GANGTAY, xóa BUAGO, thêm XITHAN và lưu', async () => {
    await ui.focusBlankCode(m1.page);
    await setCell(m1.page, 'Mặt nạ hàn tự động', 'qty', 3);
    await deleteRow(m1.page, 'Búa gõ xỉ hàn');
    await ui.focusBlankCode(m1.page);
    await ui.typeLine(m1.page, { code: 'KINHBH', qty: 4 });
    await expect(m1.page.getByText('Có thay đổi chưa lưu')).toBeVisible();

    await setCell(m2.page, 'Găng tay hàn da', 'qty', 12);
    await deleteRow(m2.page, 'Búa gõ xỉ hàn');
    await ui.focusBlankCode(m2.page);
    await ui.typeLine(m2.page, { code: 'XITHAN', qty: 1 });
    await ui.saveDraft(m2.page);

    // máy 1: được báo, chữ đang gõ còn nguyên
    const warn = m1.page.locator('.doc-alert').filter({ hasText: 'Phiếu vừa được Trần Thị Hoa (Máy 2) sửa lúc' });
    await expect(warn).toBeVisible({ timeout: 10_000 });
    await expect(warn).toContainText('Bạn đang có thay đổi chưa lưu trên máy này');
    expect(await linesOf(m1.page)).toEqual(['MATNA:3', 'GANGTAY:10', 'KINHBH:4']);
    await ui.shot(m1.page, '08-may1-canh-bao-dang-sua');
  });

  test('REQ-082 F-01: Ctrl+S báo xung đột, không ghi đè; khung vàng CHỈ có 3 thay đổi của máy 1 (sửa MATNA 2→3, xóa BUAGO, thêm KINHBH)', async () => {
    const stash = await conflictReload(m1.page);
    // bản mới nhất của máy 2 đang hiện
    await expect.poll(() => linesOf(m1.page)).toEqual(['MATNA:2', 'GANGTAY:12', 'XITHAN:1']);
    await expect(stash).toContainText('3 thay đổi của máy này');
    const rows = await stashRows(stash);
    expect(rows.map((r) => [r[0], r[1], r[3]])).toEqual([
      ['Đã sửa', 'MATNA', 'SL 2 → 3'],
      ['Thêm mới', 'KINHBH', '4'],
      ['Đã xóa', 'BUAGO', '5'],
    ]);
    // không có dòng nào máy 1 không đụng tới
    expect(rows.some((r) => r[1] === 'GANGTAY')).toBe(false);
    await ui.shot(m1.page, '08-khung-vang-chi-thay-doi-may-1');
    const api = await Api.login();
    const d = await api.docByNo(tam);
    expect(d.lines.map((l) => `${l.product_code}:${l.qty}`)).toEqual(['MATNA:2', 'GANGTAY:12', 'XITHAN:1']);
  });

  test('REQ-044 REQ-082 F-01: "Thêm các dòng này vào phiếu" gộp đúng (không lặp, giữ phần máy 2), lưu; máy 2 tự thấy', async () => {
    const stash = m1.page.locator('.doc-alert').filter({ hasText: 'Các dòng bạn đã nhập trước khi tải bản mới' });
    await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
    await expect(stash).toBeHidden();
    expect(await linesOf(m1.page)).toEqual(['MATNA:3', 'GANGTAY:12', 'XITHAN:1', 'KINHBH:4']);
    await ui.shot(m1.page, 'F01-sau-khi-gop');
    await ui.saveDraft(m1.page);
    await expect.poll(() => linesOf(m2.page), { timeout: 10_000 }).toEqual(['MATNA:3', 'GANGTAY:12', 'XITHAN:1', 'KINHBH:4']);
    const d = await (await Api.login()).docByNo(tam);
    expect(d.lines.map((l) => `${l.product_code}:${l.qty}`)).toEqual(['MATNA:3', 'GANGTAY:12', 'XITHAN:1', 'KINHBH:4']);
  });

  // PHÁT HIỆN F-10 (BAO_CAO_E2E.md): khi hai máy sửa CÙNG một dòng ở hai ô khác nhau (máy 2 sửa đơn giá, máy 1 sửa SL),
  // "Thêm các dòng này vào phiếu" chép đè cả dòng của máy 1 ⇒ đơn giá máy 2 vừa sửa bị trả về giá cũ, không báo gì.
  // Hướng dẫn: "dòng bạn sửa được sửa trên bản mới, phần máy kia đã sửa vẫn giữ".
  test.fail('REQ-082 F-01 vòng 2: máy 2 sửa giá GANGTAY 45.000→44.000, máy 1 sửa SL 12→15 ⇒ gộp được GANGTAY 15 × 44.000', async () => {
    await setCell(m2.page, 'Găng tay hàn da', 'price', 44000);
    await setCell(m1.page, 'Găng tay hàn da', 'qty', 15);
    await ui.saveDraft(m2.page);
    const stash = await conflictReload(m1.page);
    const rows = await stashRows(stash);
    expect(rows.map((r) => [r[0], r[1], r[3]])).toEqual([['Đã sửa', 'GANGTAY', 'SL 12 → 15']]);
    await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
    const got = await linesWithPrice(m1.page);
    await ui.shot(m1.page, 'F10-gop-mat-gia-may-2');
    expect(got.find((x) => x.startsWith('GANGTAY'))).toBe('GANGTAY:15@44000');
  });

  test('REQ-044 Dọn vòng 2: máy 1 bỏ thay đổi (rời phiếu), mở lại thấy bản máy 2 (GANGTAY 12 × 44.000)', async () => {
    await ui.clickMenu(m1.page, 'Bán hàng', 'Phiếu tạm đang treo');
    const c = m1.page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
    await c.waitFor({ timeout: 3000 }).then(
      () => c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click(),
      () => undefined,
    );
    await m1.page.getByRole('row', { name: new RegExp(tam) }).dblclick();
    await expect.poll(() => linesWithPrice(m1.page)).toEqual(['MATNA:3@350000', 'GANGTAY:12@44000', 'XITHAN:1@85000', 'KINHBH:4@60000']);
  });

  // PHÁT HIỆN F-10: cùng một mặt hàng trên HAI dòng (giá khác nhau). Máy 2 sửa dòng 2 (BUAGO 2→3), máy 1 sửa dòng 2 (2→4)
  // ⇒ gộp lại sửa nhầm DÒNG 1 (BUAGO 5 × 35.000 thành 4 × 30.000), dòng 2 vẫn 3.
  test.fail('REQ-082 F-01 vòng 3: cùng mặt hàng trên hai dòng — gộp sửa đúng dòng máy 1 đã sửa', async () => {
    const api = await Api.login();
    const cus = await api.findByCode('partners', 'HOANGLONG');
    const kho1 = await api.wh('KHO1');
    const d = await api.post('/documents', {
      doc_type: 'sale', partner_id: cus.id, warehouse_id: kho1.id,
      lines: [{ product_code: 'BUAGO', qty: 5, unit_price: 35000 }, { product_code: 'BUAGO', qty: 2, unit_price: 30000, note: 'giá khuyến mãi' }, { product_code: 'MATNA', qty: 1 }],
    });
    await m1.page.goto(`/chung-tu/${d.id}`);
    await m2.page.goto(`/chung-tu/${d.id}`);
    for (const p of [m1.page, m2.page]) await expect.poll(() => linesWithPrice(p)).toEqual(['BUAGO:5@35000', 'BUAGO:2@30000', 'MATNA:1@350000']);
    await setCell(m2.page, 'Búa gõ xỉ hàn', 'qty', 3, 1);
    await setCell(m1.page, 'Búa gõ xỉ hàn', 'qty', 4, 1);
    await ui.saveDraft(m2.page);
    const stash = await conflictReload(m1.page);
    await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
    const got = await linesWithPrice(m1.page);
    await ui.shot(m1.page, 'F10-gop-sua-nham-dong');
    expect(got).toEqual(['BUAGO:5@35000', 'BUAGO:4@30000', 'MATNA:1@350000']);
  });

  test('REQ-045 REQ-082 Máy 2 chốt phiếu (F9 ghi sổ); máy 1 thấy phiếu đã ghi sổ, phiếu rời khỏi danh sách treo', async () => {
    // máy 1 rời phiếu vòng 3 (bỏ thay đổi), mở lại phiếu chính
    await ui.clickMenu(m1.page, 'Bán hàng', 'Phiếu tạm đang treo');
    const c = m1.page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
    await c.waitFor({ timeout: 3000 }).then(
      () => c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click(),
      () => undefined,
    );
    await m1.page.getByRole('row', { name: new RegExp(tam) }).dblclick();
    await expect(m1.page.locator('.doc-no')).toContainText(tam);
    await m2.page.goto(docUrl);
    await expect(m2.page.locator('.doc-no')).toContainText(tam);
    const xk = await ui.postDoc(m2.page);
    await expect(m1.page.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(m1.page.locator('.doc-no b').first()).toHaveText(xk);
    await expect(m1.page.locator('.doc-meta')).toContainText('Ghi sổ: Trần Thị Hoa (Máy 2)');
    await ui.menu(m1.page, 'Bán hàng', 'Phiếu tạm đang treo');
    await expect(m1.page.getByRole('row', { name: new RegExp(tam) })).toHaveCount(0);
    expect(await (await Api.login()).debtClosing('HOANGLONG', 'receivable')).toBe(3 * 350000 + 12 * 44000 + 1 * 85000 + 4 * 60000);
  });

  // ---------- phiếu thu: xung đột hai máy ----------
  const vLines = async (page) =>
    page.locator('.voucher-editor .line-grid tbody tr').evaluateAll((trs) =>
      trs
        .map((tr) => [tr.querySelector('[data-vcell$=":desc"]')?.value ?? '', tr.querySelector('[data-vcell$=":amount"]')?.value ?? ''])
        .filter(([d, a]) => d || a)
        .map(([d, a]) => `${d}=${a}`),
    );
  async function vSet(page, rowIdx, col, value) {
    const cellEl = page.locator('.voucher-editor .line-grid tbody tr').nth(rowIdx).locator(`[data-vcell$=":${col}"]`);
    await cellEl.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(String(value));
    await page.keyboard.press('Tab');
  }
  async function vConflict(page) {
    await page.keyboard.press('Control+s');
    const dlg = page.locator('.ant-modal-confirm').filter({ hasText: 'Máy khác vừa sửa phiếu này' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Tải bản mới' }).click();
    const stash = page.locator('.doc-alert').filter({ hasText: 'Các dòng bạn đã nhập trước khi tải bản mới' });
    await expect(stash).toBeVisible();
    return stash;
  }
  let pt;
  let vUrl;

  test('REQ-060 REQ-082 F-01 phiếu thu: máy 2 thêm dòng, máy 1 sửa số tiền dòng 2 ⇒ khung vàng chỉ có thay đổi máy 1, gộp không lặp', async () => {
    pt = await ui.enterVoucher(m1.page, {
      type: 'receipt', account: 'TM', date: '20/10/2026', partner: 'HOANGLONG', partnerName: CUS.name,
      lines: [{ desc: 'Thu đợt 1', amount: '1000000' }, { desc: 'Thu đợt 2', amount: '2000000' }],
    });
    vUrl = m1.page.url();
    await m2.page.goto(vUrl);
    await expect(m2.page.locator('.doc-no')).toContainText(pt);
    // máy 2 thêm dòng 3 và lưu
    await m2.page.locator('[data-vcell$=":desc"]').last().click();
    await m2.page.keyboard.type('Thu tiền cước');
    await m2.page.keyboard.press('Enter');
    await m2.page.keyboard.type('150000');
    await m2.page.keyboard.press('Enter');
    // máy 1 (chưa lưu) sửa dòng 2
    await vSet(m1.page, 1, 'amount', '2500000');
    await m2.page.keyboard.press('Control+s');
    await ui.toast(m2.page, new RegExp(`Đã lưu ${pt}`));
    const stash = await vConflict(m1.page);
    await expect(stash).toContainText('1 thay đổi của máy này');
    await expect(stash).toContainText('Đã sửa');
    await expect(stash).toContainText('Thu đợt 2 — 2.000.000 → 2.500.000');
    await expect(stash).not.toContainText('Thu đợt 1');
    await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
    expect(await vLines(m1.page)).toEqual(['Thu đợt 1=1.000.000', 'Thu đợt 2=2.500.000', 'Thu tiền cước=150.000']);
    await m1.page.keyboard.press('Control+s');
    await ui.toast(m1.page, new RegExp(`Đã lưu ${pt}`));
    const v = await (await Api.login()).get(`/vouchers/${vUrl.split('/').pop()}`);
    expect(v.total_amount).toBe(3650000);
  });

  // PHÁT HIỆN F-10 (phiếu thu — nặng nhất): máy 2 sửa DIỄN GIẢI dòng 1, máy 1 sửa SỐ TIỀN dòng 1 ⇒ gộp lại thành HAI dòng
  // tiền (dòng cũ của máy 2 + dòng máy 1) ⇒ tổng thu bị cộng hai lần nếu kế toán bấm lưu.
  test.fail('REQ-060 REQ-082 F-01 phiếu thu: hai máy sửa cùng dòng (diễn giải / số tiền) ⇒ gộp vẫn là 1 dòng, không nhân đôi tiền', async () => {
    await expect.poll(() => vLines(m2.page), { timeout: 10_000 }).toEqual(['Thu đợt 1=1.000.000', 'Thu đợt 2=2.500.000', 'Thu tiền cước=150.000']);
    await vSet(m2.page, 0, 'desc', 'Thu đợt 1 (tiền mặt)');
    await vSet(m1.page, 0, 'amount', '1500000');
    await m2.page.keyboard.press('Control+s');
    await ui.toast(m2.page, new RegExp(`Đã lưu ${pt}`));
    const stash = await vConflict(m1.page);
    await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
    const got = await vLines(m1.page);
    await ui.shot(m1.page, 'F10-phieu-thu-nhan-doi-dong');
    expect(got).toEqual(['Thu đợt 1 (tiền mặt)=1.500.000', 'Thu đợt 2=2.500.000', 'Thu tiền cước=150.000']);
  });
});
