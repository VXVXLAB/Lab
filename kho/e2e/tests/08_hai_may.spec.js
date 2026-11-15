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
async function deleteRow(page, name, nth = 0) {
  const n = await rowOf(page, name).count();
  await rowOf(page, name).nth(nth).locator('input.code-input').click();
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


/** Các mục trong khung vàng: "<nhãn> <mã>" và, nếu cần chọn, câu giải thích. */
async function panelItems(stash) {
  return stash.locator('.stash-table tr').evaluateAll((trs) =>
    trs.map((tr) => {
      const td = [...tr.querySelectorAll('td')].map((t) => t.textContent.replace(/\s+/g, ' ').trim());
      const ch = tr.querySelector('.merge-choice-text')?.textContent.replace(/\s+/g, ' ').trim();
      return `${td[0]} ${td[1]}`.trim() + (ch ? ` | ${ch}` : '');
    }),
  );
}
/** Trong khung vàng, ở mục có câu `text`, bấm "Dùng của tôi" / "Giữ của máy kia". */
async function choose(stash, text, which) {
  const pick = stash.locator('.merge-choice').filter({ hasText: text });
  await expect(pick).toHaveCount(1);
  await pick.getByText(which === 'mine' ? 'Dùng của tôi' : 'Giữ của máy kia', { exact: true }).click();
}
async function applyStash(stash) {
  await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
  await expect(stash).toBeHidden();
}
async function moveRow(page, name, dir) {
  await rowOf(page, name).first().locator('input.code-input').click();
  await page.keyboard.press(dir === 'down' ? 'Alt+ArrowDown' : 'Alt+ArrowUp');
}
const amountOf = (lines) => lines.reduce((s, l) => { const m = /:(.+)@(.+)$/.exec(l); return s + Math.round(Number(m[1]) * Number(m[2])); }, 0);

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


  // ---------- F-01 / F-10: gộp ba chiều theo từng ô, nhiều vòng xung đột liên tiếp trên CÙNG một phiếu ----------
  // Mỗi vòng: máy 1 sửa trước (chưa lưu), máy 2 sửa và lưu; máy 1 Ctrl+S ⇒ "Máy khác vừa sửa" ⇒ Tải bản mới ⇒ khung vàng
  // (kiểm từng mục) ⇒ chọn (nếu có) ⇒ "Thêm các dòng này vào phiếu" ⇒ Ctrl+S. Sau mỗi vòng kiểm: phiếu ĐÃ LƯU trên máy chủ,
  // máy 2 tự hiện đúng như vậy, tổng tiền (máy chủ, chân phiếu hai máy), tồn kho và công nợ KHÔNG đổi (phiếu tạm).
  let api;
  let base0;
  async function round({ m1Edit, m2Edit, panel, choices = [], expected }) {
    await m1Edit(m1.page);
    await expect(m1.page.getByText('Có thay đổi chưa lưu')).toBeVisible();
    await m2Edit(m2.page);
    await ui.saveDraft(m2.page);
    const stash = await conflictReload(m1.page);
    const items = await panelItems(stash);
    if (panel) expect(items).toEqual(panel);
    for (const [text, which] of choices) await choose(stash, text, which);
    await applyStash(stash);
    expect(await linesWithPrice(m1.page)).toEqual(expected);
    await ui.saveDraft(m1.page);
    const d = await api.docByNo(tam);
    expect(d.lines.map((l) => `${l.product_code}:${l.qty}@${l.unit_price}`)).toEqual(expected);
    expect(d.total_amount).toBe(amountOf(expected));
    await expect.poll(() => linesWithPrice(m2.page), { timeout: 10_000 }).toEqual(expected);
    expect(await ui.footerSum(m1.page, 'Cộng')).toBe(amountOf(expected));
    expect(await ui.footerSum(m2.page, 'Cộng')).toBe(amountOf(expected));
    const now = await snapshot();
    expect(now).toEqual(base0);
    return items;
  }
  async function snapshot() {
    const st = {};
    for (const p of PRODUCTS) st[p.code] = (await api.stockOf(p.code)).total_stock;
    return { stock: st, debt: await api.debtClosing('HOANGLONG', 'receivable') };
  }

  test('REQ-044 REQ-082 F-01 vòng 1: máy 1 sửa SL MATNA, xóa BUAGO, thêm KINHBH; máy 2 sửa GANGTAY, xóa BUAGO, thêm XITHAN ⇒ khung vàng chỉ 3 thay đổi của máy 1, gộp không lặp', async () => {
    api = await Api.login();
    base0 = await snapshot();
    const items = await round({
      m1Edit: async (p) => {
        await setCell(p, 'Mặt nạ hàn tự động', 'qty', 3);
        await deleteRow(p, 'Búa gõ xỉ hàn');
        await ui.focusBlankCode(p);
        await ui.typeLine(p, { code: 'KINHBH', qty: 4 });
      },
      m2Edit: async (p) => {
        await setCell(p, 'Găng tay hàn da', 'qty', 12);
        await deleteRow(p, 'Búa gõ xỉ hàn');
        await ui.focusBlankCode(p);
        await ui.typeLine(p, { code: 'XITHAN', qty: 1 });
      },
      expected: ['MATNA:3@350000', 'GANGTAY:12@45000', 'XITHAN:1@85000', 'KINHBH:4@60000'],
    });
    expect(items.some((x) => x.includes('GANGTAY'))).toBe(false);
    expect(items.filter((x) => x.startsWith('Đã sửa MATNA') || x.startsWith('Thêm mới KINHBH'))).toHaveLength(2);
    await ui.shot(m1.page, 'F01-sau-khi-gop');
  });

  test('REQ-082 F-10 vòng 2: cùng dòng, KHÁC ô — máy 2 sửa giá GANGTAY 45.000→44.000, máy 1 sửa SL 12→15 ⇒ GANGTAY 15 × 44.000, không hỏi', async () => {
    const items = await round({
      m1Edit: (p) => setCell(p, 'Găng tay hàn da', 'qty', 15),
      m2Edit: (p) => setCell(p, 'Găng tay hàn da', 'price', 44000),
      expected: ['MATNA:3@350000', 'GANGTAY:15@44000', 'XITHAN:1@85000', 'KINHBH:4@60000'],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/^Đã sửa GANGTAY$/);
  });

  test('REQ-082 F-10 vòng 3: cùng ô SL — máy 2: 5, máy 1: 6 ⇒ khung vàng "Cùng sửa: SL — máy kia: 5, bạn: 6", mặc định giữ của máy kia', async () => {
    const items = await round({
      m1Edit: (p) => setCell(p, 'Mặt nạ hàn tự động', 'qty', 6),
      m2Edit: (p) => setCell(p, 'Mặt nạ hàn tự động', 'qty', 5),
      expected: ['MATNA:5@350000', 'GANGTAY:15@44000', 'XITHAN:1@85000', 'KINHBH:4@60000'],
    });
    expect(items).toEqual(['Cùng sửa MATNA | Cùng sửa: SL — máy kia: 5, bạn: 6']);
  });

  test('REQ-082 F-10 vòng 4: cùng ô Đơn giá — máy 2: 58.000, máy 1: 55.000, chọn "Dùng của tôi" ⇒ 55.000', async () => {
    await round({
      m1Edit: (p) => setCell(p, 'Kính bảo hộ hàn', 'price', 55000),
      m2Edit: (p) => setCell(p, 'Kính bảo hộ hàn', 'price', 58000),
      panel: ['Cùng sửa KINHBH | Cùng sửa: Đơn giá — máy kia: 58.000, bạn: 55.000'],
      choices: [['Đơn giá', 'mine']],
      expected: ['MATNA:5@350000', 'GANGTAY:15@44000', 'XITHAN:1@85000', 'KINHBH:4@55000'],
    });
  });

  test('REQ-082 F-10 vòng 5: máy kia XÓA dòng, tôi SỬA dòng đó ⇒ hỏi, mặc định giữ bản đã lưu (dòng bị xóa)', async () => {
    await round({
      m1Edit: (p) => setCell(p, 'Bình xịt chống dính hàn', 'qty', 2),
      m2Edit: (p) => deleteRow(p, 'Bình xịt chống dính hàn'),
      panel: ['Máy kia đã xóa XITHAN | Máy kia đã xóa dòng này, bạn đã sửa'],
      expected: ['MATNA:5@350000', 'GANGTAY:15@44000', 'KINHBH:4@55000'],
    });
  });

  test('REQ-082 F-10 vòng 6: máy kia XÓA dòng, tôi SỬA, chọn "Dùng của tôi" ⇒ dòng còn với số của tôi, về đúng chỗ cũ', async () => {
    await round({
      m1Edit: (p) => setCell(p, 'Găng tay hàn da', 'qty', 16),
      m2Edit: (p) => deleteRow(p, 'Găng tay hàn da'),
      choices: [['Máy kia đã xóa dòng này', 'mine']],
      // quy tắc (vòng 4): dòng giữ lại về đúng chỗ cũ — sau dòng đứng trước nó lúc tải (MATNA)
      expected: ['MATNA:5@350000', 'GANGTAY:16@44000', 'KINHBH:4@55000'],
    });
  });

  test('REQ-082 F-10 vòng 7: tôi XÓA dòng, máy kia SỬA dòng đó ⇒ hỏi, mặc định giữ bản đã lưu (dòng còn, số máy kia)', async () => {
    await round({
      m1Edit: (p) => deleteRow(p, 'Mặt nạ hàn tự động'),
      m2Edit: (p) => setCell(p, 'Mặt nạ hàn tự động', 'qty', 7),
      panel: ['Máy kia đã sửa MATNA | Máy kia đã sửa dòng này, bạn đã xóa'],
      expected: ['MATNA:7@350000', 'GANGTAY:16@44000', 'KINHBH:4@55000'],
    });
  });

  test('REQ-082 F-10 vòng 8: tôi dời dòng (Alt+↓), máy kia sửa SL ⇒ thứ tự của tôi + số của máy kia', async () => {
    const items = await round({
      m1Edit: (p) => moveRow(p, 'Mặt nạ hàn tự động', 'down'),
      m2Edit: (p) => setCell(p, 'Kính bảo hộ hàn', 'qty', 9),
      expected: ['GANGTAY:16@44000', 'MATNA:7@350000', 'KINHBH:9@55000'],
    });
    expect(items.some((x) => x.startsWith('Đổi thứ tự'))).toBe(true);
  });

  test('REQ-082 F-10 vòng 9: hai máy cùng dời dòng mỗi máy một kiểu ⇒ "Cùng đổi thứ tự", mặc định thứ tự của máy kia', async () => {
    const items = await round({
      m1Edit: (p) => moveRow(p, 'Kính bảo hộ hàn', 'up'), // tôi: GANGTAY, KINHBH, MATNA
      m2Edit: (p) => moveRow(p, 'Găng tay hàn da', 'down'), // máy kia: MATNA, GANGTAY, KINHBH
      expected: ['MATNA:7@350000', 'GANGTAY:16@44000', 'KINHBH:9@55000'],
    });
    expect(items.some((x) => x.startsWith('Cùng đổi thứ tự'))).toBe(true);
  });

  test('REQ-082 F-10 vòng 10: tôi xóa rồi thêm lại y hệt KINHBH, máy kia sửa dòng khác ⇒ chỉ một KINHBH, số máy kia giữ', async () => {
    await round({
      m1Edit: async (p) => {
        await deleteRow(p, 'Kính bảo hộ hàn');
        await ui.focusBlankCode(p);
        await ui.typeLine(p, { code: 'KINHBH', qty: 9, price: '55000' });
      },
      m2Edit: (p) => setCell(p, 'Mặt nạ hàn tự động', 'qty', 8),
      expected: ['MATNA:8@350000', 'GANGTAY:16@44000', 'KINHBH:9@55000'],
    });
  });

  test('REQ-082 F-10 vòng 11: tôi xóa rồi thêm lại KINHBH, máy kia SỬA chính dòng KINHBH cũ ⇒ hỏi; chọn "Dùng của tôi" ⇒ chỉ dòng tôi thêm lại', async () => {
    const items = await round({
      m1Edit: async (p) => {
        await deleteRow(p, 'Kính bảo hộ hàn');
        await ui.focusBlankCode(p);
        await ui.typeLine(p, { code: 'KINHBH', qty: 9, price: '55000' });
      },
      m2Edit: (p) => setCell(p, 'Kính bảo hộ hàn', 'qty', 10),
      choices: [['Máy kia đã sửa dòng này, bạn đã xóa', 'mine']],
      expected: ['MATNA:8@350000', 'GANGTAY:16@44000', 'KINHBH:9@55000'],
    });
    expect(items.filter((x) => /KINHBH/.test(x))).toHaveLength(2); // "Đã/Máy kia đã sửa … bạn đã xóa" + "Thêm mới"
  });

  test('REQ-045 REQ-082 Máy 2 chốt phiếu (F9 ghi sổ); máy 1 thấy đã ghi sổ; tồn kho và công nợ đổi đúng theo bản gộp cuối', async () => {
    const xk = await ui.postDoc(m2.page);
    await expect(m1.page.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(m1.page.locator('.doc-no b').first()).toHaveText(xk);
    await expect(m1.page.locator('.doc-meta')).toContainText('Ghi sổ: Trần Thị Hoa (Máy 2)');
    const now = await snapshot();
    expect(now.stock).toEqual({ ...base0.stock, MATNA: base0.stock.MATNA - 8, GANGTAY: base0.stock.GANGTAY - 16, KINHBH: base0.stock.KINHBH - 9 });
    expect(now.debt).toBe(base0.debt + 8 * 350000 + 16 * 44000 + 9 * 55000);
    await ui.menu(m1.page, 'Bán hàng', 'Phiếu tạm đang treo');
    await expect(m1.page.getByRole('row', { name: new RegExp(tam) })).toHaveCount(0);
  });

  test('REQ-038 REQ-082 F-10 phiếu ĐÃ GHI SỔ: hai máy cùng F8 sửa (máy 2 giá, máy 1 SL) ⇒ gộp, lưu; tồn kho và công nợ tính lại đúng', async () => {
    await m1.page.goto(docUrl);
    await m2.page.goto(docUrl);
    for (const p of [m1.page, m2.page]) {
      await expect(p.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
      await p.keyboard.press('F8');
      await expect(p.getByText('ĐANG SỬA phiếu đã ghi sổ', { exact: true })).toBeVisible();
    }
    const before = await snapshot();
    await setCell(m1.page, 'Găng tay hàn da', 'qty', 20);
    await setCell(m2.page, 'Mặt nạ hàn tự động', 'price', 340000);
    await m2.page.keyboard.press('Control+s');
    await ui.toast(m2.page, /Đã lưu thay đổi phiếu/);
    const stash = await conflictReload(m1.page);
    // F-18 (vòng 3) đã sửa ở vòng 4: còn thay đổi chưa lưu ⇒ vẫn ở chế độ sửa, có ngay nút gộp (không cần F8)
    await expect(m1.page.getByText('ĐANG SỬA phiếu đã ghi sổ', { exact: true })).toBeVisible();
    await expect(stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' })).toBeVisible();
    await ui.shot(m1.page, 'F18-phieu-ghi-so-sau-tai-ban-moi');
    await applyStash(stash);
    const expected = ['MATNA:8@340000', 'GANGTAY:20@44000', 'KINHBH:9@55000'];
    expect(await linesWithPrice(m1.page)).toEqual(expected);
    await m1.page.keyboard.press('Control+s');
    await ui.toast(m1.page, /Đã lưu thay đổi phiếu/);
    const d = await api.docByNo(tam);
    expect(d.lines.map((l) => `${l.product_code}:${l.qty}@${l.unit_price}`)).toEqual(expected);
    expect(d.total_amount).toBe(amountOf(expected));
    const now = await snapshot();
    expect(now.stock.GANGTAY).toBe(before.stock.GANGTAY - 4);
    expect(now.debt).toBe(before.debt + 4 * 44000 - 8 * 10000);
    await expect.poll(() => linesWithPrice(m2.page), { timeout: 10_000 }).toEqual(expected);
  });

  test('REQ-082 F-10 cùng mặt hàng trên BA dòng: mỗi máy sửa một dòng ⇒ đúng dòng; cùng sửa ⇒ hỏi; dòng giữ lại về đúng chỗ (đầu, giữa, cuối)', async () => {
    const cus = await api.findByCode('partners', 'HOANGLONG');
    const kho1 = await api.wh('KHO1');
    const d = await api.post('/documents', {
      doc_type: 'sale', partner_id: cus.id, warehouse_id: kho1.id,
      lines: [
        { product_code: 'BUAGO', qty: 5, unit_price: 35000 },
        { product_code: 'BUAGO', qty: 2, unit_price: 30000, note: 'giá khuyến mãi' },
        { product_code: 'BUAGO', qty: 1, unit_price: 33000, note: 'hàng trưng bày' },
        { product_code: 'MATNA', qty: 1 },
      ],
    });
    tam = d.draft_no;
    base0 = await snapshot(); // phiếu tạm mới: tồn kho và công nợ không được đổi qua các vòng dưới
    for (const p of [m1.page, m2.page]) {
      await p.goto(`/chung-tu/${d.id}`);
      await expect.poll(() => linesWithPrice(p)).toEqual(['BUAGO:5@35000', 'BUAGO:2@30000', 'BUAGO:1@33000', 'MATNA:1@350000']);
    }
    // a) máy 2 sửa giá dòng 3, máy 1 sửa SL dòng 1 ⇒ cả hai, đúng dòng
    await round({
      m1Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'qty', 6, 0),
      m2Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'price', 32000, 2),
      expected: ['BUAGO:6@35000', 'BUAGO:2@30000', 'BUAGO:1@32000', 'MATNA:1@350000'],
    });
    // b) cùng sửa SL dòng 2: máy kia 3, tôi 4 ⇒ mặc định 3, dòng 1 và 3 không đổi
    await round({
      m1Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'qty', 4, 1),
      m2Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'qty', 3, 1),
      panel: ['Cùng sửa BUAGO | Cùng sửa: SL — máy kia: 3, bạn: 4'],
      expected: ['BUAGO:6@35000', 'BUAGO:3@30000', 'BUAGO:1@32000', 'MATNA:1@350000'],
    });
    // c) cùng sửa SL dòng 3: máy kia 2, tôi 7, chọn của tôi
    await round({
      m1Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'qty', 7, 2),
      m2Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'qty', 2, 2),
      choices: [['máy kia: 2, bạn: 7', 'mine']],
      expected: ['BUAGO:6@35000', 'BUAGO:3@30000', 'BUAGO:7@32000', 'MATNA:1@350000'],
    });
    // d) quy tắc chỗ của dòng giữ lại: dòng ĐẦU (không có dòng đứng trước) bị máy kia xóa, tôi sửa, giữ của tôi ⇒ về lại đầu
    //    (đứng trước dòng kế nó)
    await round({
      m1Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'qty', 9, 0),
      m2Edit: (p) => deleteRow(p, 'Búa gõ xỉ hàn', 0),
      choices: [['Máy kia đã xóa dòng này', 'mine']],
      expected: ['BUAGO:9@35000', 'BUAGO:3@30000', 'BUAGO:7@32000', 'MATNA:1@350000'],
    });
    // e) máy kia xóa CẢ dòng 2 (đứng trước) lẫn dòng 3; tôi sửa dòng 3, giữ của tôi ⇒ dòng 3 đứng trước dòng kế (MATNA);
    //    dòng 2 (tôi không sửa) mất
    await round({
      m1Edit: (p) => setCell(p, 'Búa gõ xỉ hàn', 'qty', 8, 2),
      m2Edit: async (p) => {
        await deleteRow(p, 'Búa gõ xỉ hàn', 1);
        await deleteRow(p, 'Búa gõ xỉ hàn', 1);
      },
      choices: [['Máy kia đã xóa dòng này', 'mine']],
      expected: ['BUAGO:9@35000', 'BUAGO:8@32000', 'MATNA:1@350000'],
    });
    // f) dòng CUỐI bị máy kia xóa (không có dòng kế; dòng đứng trước cũng bị xóa) ⇒ cuối phiếu
    await round({
      m1Edit: (p) => setCell(p, 'Mặt nạ hàn tự động', 'qty', 2),
      m2Edit: async (p) => {
        await deleteRow(p, 'Búa gõ xỉ hàn', 1);
        await deleteRow(p, 'Mặt nạ hàn tự động');
      },
      choices: [['Máy kia đã xóa dòng này', 'mine']],
      expected: ['BUAGO:9@35000', 'MATNA:2@350000'],
    });
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
  async function vDelete(page, rowIdx) {
    await page.locator('.voucher-editor .line-grid tbody tr').nth(rowIdx).locator('[data-vcell$=":desc"]').click();
    await page.keyboard.press('Control+Delete');
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
  let vId;
  let vDebt0;
  /** Một vòng xung đột phiếu thu; kiểm phiếu đã lưu, máy 2, tổng, công nợ khách. */
  async function vRound({ m1Edit, m2Edit, choices = [], expected, total, stashHas }) {
    await m1Edit(m1.page);
    await m2Edit(m2.page);
    await m2.page.keyboard.press('Control+s');
    await ui.toast(m2.page, new RegExp(`Đã lưu ${pt}`));
    const stash = await vConflict(m1.page);
    for (const t of stashHas ?? []) await expect(stash).toContainText(t);
    for (const [text, which] of choices) await choose(stash, text, which);
    await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
    expect(await vLines(m1.page)).toEqual(expected);
    await m1.page.keyboard.press('Control+s');
    await ui.toast(m1.page, new RegExp(`Đã lưu ${pt}`));
    const v = await api.get(`/vouchers/${vId}`);
    expect(v.lines.map((l) => `${l.description}=${ui.money(l.amount)}`)).toEqual(expected);
    expect(v.total_amount).toBe(total);
    await expect.poll(() => vLines(m2.page), { timeout: 10_000 }).toEqual(expected);
    expect(await api.debtClosing('HOANGLONG', 'receivable')).toBe(vDebt0 - total);
  }

  test('REQ-060 REQ-082 F-01 phiếu thu vòng 1: máy 2 thêm dòng, máy 1 sửa số tiền dòng 2 ⇒ gộp không lặp', async () => {
    vDebt0 = await api.debtClosing('HOANGLONG', 'receivable');
    pt = await ui.enterVoucher(m1.page, {
      type: 'receipt', account: 'TM', date: '20/10/2026', partner: 'HOANGLONG', partnerName: CUS.name,
      lines: [{ desc: 'Thu đợt 1', amount: '1000000' }, { desc: 'Thu đợt 2', amount: '2000000' }],
    });
    vId = m1.page.url().split('/').pop();
    await m2.page.goto(`/phieu-thu-chi/${vId}`);
    await expect(m2.page.locator('.doc-no')).toContainText(pt);
    await vRound({
      m1Edit: (p) => vSet(p, 1, 'amount', '2500000'),
      m2Edit: async (p) => {
        await p.locator('[data-vcell$=":desc"]').last().click();
        await p.keyboard.type('Thu tiền cước');
        await p.keyboard.press('Enter');
        await p.keyboard.type('150000');
        await p.keyboard.press('Enter');
      },
      stashHas: ['1 thay đổi của máy này', 'Thu đợt 2 — 2.000.000 → 2.500.000'],
      expected: ['Thu đợt 1=1.000.000', 'Thu đợt 2=2.500.000', 'Thu tiền cước=150.000'],
      total: 3650000,
    });
  });

  test('REQ-060 REQ-082 F-10 phiếu thu vòng 2: cùng dòng KHÁC ô (máy 2 diễn giải, máy 1 số tiền) ⇒ một dòng, không nhân đôi tiền', async () => {
    await vRound({
      m1Edit: (p) => vSet(p, 0, 'amount', '1500000'),
      m2Edit: (p) => vSet(p, 0, 'desc', 'Thu đợt 1 (tiền mặt)'),
      expected: ['Thu đợt 1 (tiền mặt)=1.500.000', 'Thu đợt 2=2.500.000', 'Thu tiền cước=150.000'],
      total: 4150000,
    });
  });

  test('REQ-060 REQ-082 F-10 phiếu thu vòng 3–4: cùng ô Số tiền — mặc định của máy kia; rồi chọn "Dùng của tôi"', async () => {
    await vRound({
      m1Edit: (p) => vSet(p, 1, 'amount', '2700000'),
      m2Edit: (p) => vSet(p, 1, 'amount', '2600000'),
      stashHas: ['Cùng sửa: Số tiền — máy kia: 2.600.000, bạn: 2.700.000'],
      expected: ['Thu đợt 1 (tiền mặt)=1.500.000', 'Thu đợt 2=2.600.000', 'Thu tiền cước=150.000'],
      total: 4250000,
    });
    await vRound({
      m1Edit: (p) => vSet(p, 2, 'amount', '250000'),
      m2Edit: (p) => vSet(p, 2, 'amount', '200000'),
      choices: [['Số tiền — máy kia: 200.000, bạn: 250.000', 'mine']],
      expected: ['Thu đợt 1 (tiền mặt)=1.500.000', 'Thu đợt 2=2.600.000', 'Thu tiền cước=250.000'],
      total: 4350000,
    });
  });

  test('REQ-060 REQ-082 F-10 phiếu thu vòng 5–6: máy kia xóa dòng tôi sửa (mặc định xóa); tôi xóa dòng máy kia sửa (mặc định giữ)', async () => {
    await vRound({
      m1Edit: (p) => vSet(p, 2, 'desc', 'Thu tiền cước xe'),
      m2Edit: (p) => vDelete(p, 2),
      stashHas: ['Máy kia đã xóa dòng này, bạn đã sửa'],
      expected: ['Thu đợt 1 (tiền mặt)=1.500.000', 'Thu đợt 2=2.600.000'],
      total: 4100000,
    });
    await vRound({
      m1Edit: (p) => vDelete(p, 0),
      m2Edit: (p) => vSet(p, 0, 'amount', '1400000'),
      stashHas: ['Máy kia đã sửa dòng này, bạn đã xóa'],
      expected: ['Thu đợt 1 (tiền mặt)=1.400.000', 'Thu đợt 2=2.600.000'],
      total: 4000000,
    });
  });
});
