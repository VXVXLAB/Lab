// Thao tác giao diện như người dùng: theo nhãn tiếng Việt, vai trò và bàn phím.
// Chỉ dùng id/class khi nhãn hiển thị không gắn với ô (các ô đầu phiếu không có <label for>).
const fs = require('fs');
const path = require('path');
const { expect } = require('playwright/test');
const { OUT } = require('./env');

const SHOTS = path.join(OUT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

/** Chụp màn hình vào out/screenshots/<tên>.png, trả đường dẫn tương đối e2e/. */
async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  // chờ hiệu ứng mở ngăn kéo / hộp thoại chạy xong để ảnh đúng cái người dùng thấy
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 3000 })
    .catch(() => undefined);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(path.resolve(OUT, '..'), file);
}

// ---------- số / ngày ----------
/** "3.990.000" → 3990000; "50,0" → 50; "-" / "" → 0 */
function vnNum(s) {
  const t = String(s ?? '').trim().replace(/\s|đ/g, '');
  if (!t || t === '-' || t === '—') return 0;
  return Number(t.replace(/\./g, '').replace(',', '.'));
}
const money = (n) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n);

// ---------- đăng nhập / điều hướng ----------
async function login(page, username, password) {
  await page.goto('/');
  await page.getByLabel('Tên đăng nhập').fill(username);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByLabel('Mật khẩu').press('Enter');
  await expect(page.getByRole('button', { name: 'Tài khoản', exact: true })).toBeVisible();
}

/** Mở màn hình qua menu trái: menu('Bán hàng', 'Phiếu bán'). */
async function menu(page, group, item) {
  const nav = page.getByRole('complementary').getByRole('menu').first();
  let link;
  if (!item) link = nav.getByRole('link', { name: group, exact: true });
  else {
    link = nav.getByRole('link', { name: item, exact: true });
    if (!(await link.isVisible())) await nav.getByRole('menuitem', { name: new RegExp(group) }).first().click();
  }
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page).toHaveURL((u) => u.pathname === href);
  // chờ màn mới vẽ xong (tiêu đề trang đổi theo menu)
  await expect(page.locator('.crumb-title')).toHaveText(item ?? group);
}

/** Bấm mục menu trái (mở nhóm nếu cần) mà KHÔNG chờ chuyển trang — dùng khi trang có thể chặn rời đi. */
async function clickMenu(page, group, item) {
  const nav = page.getByRole('complementary').getByRole('menu').first();
  const link = nav.getByRole('link', { name: item, exact: true });
  if (!(await link.isVisible())) await nav.getByRole('menuitem', { name: new RegExp(group) }).first().click();
  await link.click();
}

/** Chờ thông báo nổi (antd message) có nội dung khớp. Trả nội dung. */
async function toast(page, re) {
  const n = page.locator('.ant-message-notice').filter({ hasText: re }).last();
  await expect(n).toBeVisible();
  return (await n.innerText()).trim();
}

/** Hộp thoại xác nhận/lỗi đang mở (antd Modal.confirm/error). */
function dialog(page) {
  return page.locator('.ant-modal-confirm, .ant-modal').filter({ has: page.locator('.ant-modal-confirm-title, .ant-modal-title') }).last();
}

/** Ô chọn antd (Select có tìm kiếm): gõ chữ rồi chọn mục khớp bằng Enter. */
async function selectByTyping(page, combo, text, optionRe) {
  await combo.focus();
  await combo.pressSequentially(text, { delay: 20 });
  const dd = await dropdownOf(page, combo);
  const opt = dd.locator('.ant-select-item-option').filter({ hasText: optionRe ?? text });
  await expect(opt.first()).toBeVisible();
  // chờ ô tìm có kết quả của đúng chữ vừa gõ (không còn "đang chờ") và mục khớp đứng đầu danh sách — như người dùng
  // nhìn thấy rồi mới Enter. (Ô lọc tại máy, như Kho/Nhóm, không có cờ chờ.)
  await expect(page.locator('[data-search-pending]')).toHaveCount(0);
  await expect(dd.locator('.ant-select-item-option').first()).toContainText(optionRe ?? text);
  // (đọc trước khi Enter: sau khi chọn, ô có thể không còn khớp bộ định vị — vd. lọc theo chữ "Mặt hàng…")
  // F-17 chỉ ở ô tìm có "chặn Enter" (.search-guard: khách, mặt hàng) nằm ngoài biểu mẫu có ô kế tiếp. Ô chọn thường (Nhóm,
  // Kho…) tự đóng khi Enter — KHÔNG bấm Esc ở đó (Esc khi danh sách đang đóng dần sẽ đóng luôn hộp thoại).
  const inForm = await combo.evaluate((el) => !el.closest('.search-guard') || !!el.closest('[data-enter-scope]'));
  const input = await combo.elementHandle();
  // F-11 (b) đã sửa ở vòng 3: Enter chọn kết quả đầu tiên kể cả khi không mục nào sáng — không bấm ↓ hộ người dùng nữa.
  await combo.press('Enter');
  // PHÁT HIỆN F-17 (BAO_CAO_E2E.md): ở ô chọn mặt hàng/khách của bộ lọc (báo cáo, thẻ kho — không nằm trong biểu mẫu
  // có "ô kế tiếp"), chọn xong bằng Enter thì danh sách VẪN MỞ, che bảng, mục đầu ("DV – Dịch vụ") sáng ⇒ Enter lần nữa
  // đổi lựa chọn. Người dùng thấy danh sách còn mở thì bấm Esc (giữ nguyên lựa chọn) — làm như vậy ở đây; lỗi được
  // kiểm nghiêm (test.fail) ở tests/15.
  if (!inForm) {
    await expect(page.locator('[data-search-owner]')).toHaveCount(0);
    if (await dd.isVisible()) {
      await input.press('Escape');
      await expect(dd).toHaveCount(0);
    }
  }
}

/** Danh sách thả xuống của đúng ô chọn này (theo aria-controls). */
async function dropdownOf(page, combo) {
  const id = await combo.getAttribute('aria-controls');
  return page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').filter({ has: page.locator(`[id="${id}"]`) });
}

/** Chọn một mục trong Select antd bằng chuột (bộ lọc báo cáo). */
async function selectOption(page, combo, optionRe) {
  await combo.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " ant-select-selector ")][1]').click();
  const dd = await dropdownOf(page, combo);
  await dd.locator('.ant-select-item-option').filter({ hasText: optionRe }).first().click();
  await expect(dd).toHaveCount(0);
}

/** Xóa lựa chọn của Select antd có allowClear (rê chuột rồi bấm dấu x). */
async function clearSelect(selectRoot) {
  await selectRoot.hover();
  await selectRoot.locator('.ant-select-clear').click();
}

/** Bộ lọc khoảng ngày: chọn "Khoảng ngày…" rồi gõ từ/đến; hoặc preset như "Tất cả". */
async function setRange(page, scope, from, to) {
  const combo = scope.getByRole('combobox', { name: 'Khoảng thời gian' });
  if (!from) {
    await selectOption(page, combo, /^Tất cả$/);
    return;
  }
  await selectOption(page, combo, 'Khoảng ngày…');
  await scope.getByPlaceholder('Từ ngày').fill(from);
  await scope.getByPlaceholder('Từ ngày').press('Tab');
  await scope.getByPlaceholder('Đến ngày').fill(to);
  await scope.getByPlaceholder('Đến ngày').press('Tab');
}

// ---------- phiếu kho (chứng từ) ----------
const focused = (page, sel) => expect(page.locator(`${sel}:focus`)).toHaveCount(1);

/** Ở màn danh sách: bấm F2 để lập phiếu mới (như hướng dẫn). */
async function newDocByF2(page, listHeading) {
  await expect(page.getByRole('heading', { name: listHeading })).toBeVisible();
  await page.locator('body').press('F2');
  await expect(page).toHaveURL(/\/chung-tu\/moi/);
  await expect(page.getByText('PHIẾU MỚI — chưa lưu')).toBeVisible();
}

async function setDocDate(page, ddmmyyyy) {
  const d = page.locator('#doc_date');
  await d.click();
  await d.fill(ddmmyyyy);
  await d.press('Tab');
  await expect(d).toHaveValue(ddmmyyyy);
}

/** Chọn khách hàng/NCC trong phiếu: gõ vài chữ (không dấu) + Enter. */
async function pickPartner(page, text, nameRe) {
  await selectByTyping(page, page.locator('#partner'), text, nameRe);
  await expect(page.locator('.hf-partner .ant-select-selection-item')).toContainText(nameRe ?? text);
}

async function pickWarehouse(page, code, id = '#warehouse') {
  const sel = page.locator(id);
  await selectByTyping(page, sel, code, new RegExp(`^${code} –`));
  await expect(page.locator(`.ant-select:has(${id}) .ant-select-selection-item`)).toContainText(code);
}

/** Con trỏ vào ô mã hàng của dòng trống cuối. */
async function focusBlankCode(page) {
  const c = page.locator('.line-grid tbody tr.row-blank input.code-input').last();
  await c.click();
  return c;
}

/**
 * Gõ một dòng hàng hoàn toàn bằng bàn phím, bắt đầu từ ô Mã hàng đang có con trỏ:
 * Mã → Enter → SL → Enter → Đơn giá → Enter (sang dòng sau). Dịch vụ: Mã → Enter → Diễn giải → Enter → Đơn giá → Enter.
 * qty/price === undefined ⇒ giữ nguyên giá trị tự điền. price === '' ⇒ để trống.
 */
async function typeLine(page, { code, qty, price, desc }, { hasPrice = true } = {}) {
  await focused(page, 'input.code-input');
  await page.keyboard.type(code, { delay: 15 });
  await page.keyboard.press('Enter');
  const isService = desc !== undefined;
  if (isService) {
    await focused(page, '[data-cell$=":desc"]');
    await page.keyboard.type(desc, { delay: 10 });
    await page.keyboard.press('Enter');
  } else {
    await focused(page, '[data-cell$=":qty"]');
    if (qty !== undefined) await page.keyboard.type(String(qty), { delay: 15 });
    await page.keyboard.press('Enter');
  }
  if (hasPrice) {
    await focused(page, '[data-cell$=":price"]');
    if (price === '') await page.keyboard.press('Delete');
    else if (price !== undefined) await page.keyboard.type(String(price), { delay: 15 });
    await page.keyboard.press('Enter');
  }
  await focused(page, 'input.code-input');
}

/** Đọc lưới dòng của phiếu đang mở (chế độ sửa hoặc chỉ xem). */
async function readLines(page) {
  return page.locator('.line-grid tbody tr:not(.row-blank)').evaluateAll((trs) =>
    trs.map((tr) => {
      const td = [...tr.querySelectorAll(':scope > td')];
      const val = (cell) => {
        if (!cell) return '';
        const i = cell.querySelector('input');
        return (i ? i.value : cell.querySelector('.ro')?.textContent ?? cell.textContent ?? '').trim();
      };
      return {
        stt: td[0]?.textContent.trim(),
        code: val(td[1]),
        name: (td[2]?.querySelector('input')?.value ?? td[2]?.querySelector('.ro')?.textContent ?? '').trim(),
        unit: td[3]?.textContent.trim(),
        qty: val(td[4]),
        price: val(td[5]),
        amount: td[6]?.textContent.trim(),
        notes: tr.textContent,
      };
    }),
  );
}

/** Ô tổng ở chân phiếu: sum(page,'Cộng') → số. */
async function footerSum(page, label) {
  const cell = page.locator('.doc-sums > div').filter({ has: page.locator('span', { hasText: new RegExp(`^${label}`) }) }).first();
  return vnNum(await cell.locator('b').innerText());
}

async function saveDraft(page) {
  await page.keyboard.press('Control+s');
  await expect(page.getByText('PHIẾU TẠM — chưa ghi sổ', { exact: true })).toBeVisible();
  const no = (await page.locator('.doc-no b').first().innerText()).trim();
  expect(no).toMatch(/^TAM\d+$/);
  await toast(page, new RegExp(`Đã lưu phiếu tạm ${no}`));
  return no;
}

/** F9 ghi sổ (không có cảnh báo). Trả số chính thức. */
async function postDoc(page) {
  await page.keyboard.press('F9');
  await expect(page.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
  const no = (await page.locator('.doc-no b').first().innerText()).trim();
  expect(no).toMatch(/^(XK|NK|CK|TDK)\d{5}$/);
  await toast(page, new RegExp(`Đã ghi sổ — số phiếu ${no}`));
  return no;
}

/** Bấm vào trang để con trỏ không nằm trong ô nhập (phím tắt cấp trang). */
async function blurAll(page) {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
}

const DOC_SCREENS = {
  sale: ['Bán hàng', 'Phiếu bán', /^Phiếu bán hàng/],
  sale_return: ['Bán hàng', 'Khách trả hàng', /^Khách trả hàng/],
  purchase: ['Mua hàng', 'Phiếu nhập', /^Phiếu nhập mua hàng/],
  purchase_return: ['Mua hàng', 'Trả hàng NCC', /^Trả hàng nhà cung cấp/],
  transfer: ['Kho', 'Chuyển kho', /^Chuyển kho nội bộ/],
  opening: ['Kho', 'Tồn đầu kỳ', /^Tồn đầu kỳ/],
};

/**
 * Lập một phiếu qua giao diện như kế toán: menu → F2 → ngày → đối tác (gõ + Enter) → kho → ghi chú → dòng (bàn phím).
 * action: 'post' (F9, trả số chính thức) | 'save' (Ctrl+S, trả số tạm) | 'none'.
 */
async function enterDoc(page, { type, date, partner, partnerName, wh, toWh, note, lines, action = 'post' }) {
  const [g, item, heading] = DOC_SCREENS[type];
  await menu(page, g, item);
  await newDocByF2(page, heading);
  if (date) await setDocDate(page, date);
  if (partner) await pickPartner(page, partner, partnerName);
  if (wh) await pickWarehouse(page, wh);
  if (toWh) await pickWarehouse(page, toWh, '#to_warehouse');
  if (note) await page.locator('#note').fill(note);
  await focusBlankCode(page);
  for (const l of lines) await typeLine(page, l, { hasPrice: type !== 'transfer' });
  if (action === 'post') return postDoc(page);
  if (action === 'save') return saveDraft(page);
  return null;
}

// ---------- phiếu thu / chi ----------
/**
 * Lập phiếu thu/chi qua giao diện: Quỹ & Ngân hàng › Thu tiền / Chi tiền → F2 → chọn Tiền mặt/Ngân hàng →
 * ngày → đối tác → ghi chú → các dòng (Diễn giải → Enter → Số tiền → Enter) → Ctrl+S. Trả số phiếu.
 * side: chữ của lựa chọn "Phiếu này là" khi đối tác ở phía ngược (NCC hoàn tiền / trả lại tiền khách).
 */
async function enterVoucher(page, { type, account = 'TM', date, partner, partnerName, side, note, lines, save = true }) {
  await menu(page, 'Quỹ & Ngân hàng', type === 'receipt' ? 'Thu tiền' : 'Chi tiền');
  await expect(page.getByRole('heading', { name: type === 'receipt' ? /^Phiếu thu tiền/ : /^Phiếu chi tiền/ })).toBeVisible();
  await page.locator('body').press('F2');
  await expect(page.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
  // Vòng 3: KHÔNG chờ con trỏ vào ô đối tác nữa — ngày gõ ngay sau khi mở phiếu phải được giữ (đã sửa ở vòng 3).
  await page.locator('.acc-choice label').filter({ hasText: `${account} ·` }).click();
  if (date) {
    const d = page.locator('#voucher_date');
    await d.fill(date);
    await d.press('Tab');
    await expect(d).toHaveValue(date);
  }
  if (partner) {
    await selectByTyping(page, page.locator('#partner'), partner, partnerName);
    await expect(page.locator('.hf-partner .ant-select-selection-item')).toContainText(partnerName ?? partner);
  }
  if (side) await page.locator('.side-choice').getByText(side).click();
  if (note) await page.locator('#vnote').fill(note);
  await page.locator('[data-vcell$=":desc"]').last().click();
  for (const l of lines) {
    await focused(page, '[data-vcell$=":desc"]');
    await page.keyboard.type(l.desc, { delay: 5 });
    await page.keyboard.press('Enter');
    await focused(page, '[data-vcell$=":amount"]');
    await page.keyboard.type(String(l.amount), { delay: 10 });
    await page.keyboard.press('Enter');
  }
  if (!save) return null;
  await page.keyboard.press('Control+s');
  await expect(page.getByText('ĐÃ LƯU — có hiệu lực', { exact: true })).toBeVisible();
  const no = (await page.locator('.doc-no b').first().innerText()).trim();
  await toast(page, new RegExp(`Đã lưu ${no} — sổ quỹ và công nợ đã cập nhật`));
  return no;
}

// ---------- tải file ----------
async function download(page, action, name) {
  const [dl] = await Promise.all([page.waitForEvent('download'), action()]);
  const dir = path.join(OUT, 'files');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name ?? dl.suggestedFilename());
  await dl.saveAs(file);
  return { file, suggested: dl.suggestedFilename() };
}

/** Nút "In ▾" của phiếu → mục "Xuất Excel (.xlsx)" / "Xuất Word (.docx)". */
async function exportDoc(page, kind, name) {
  return download(
    page,
    async () => {
      await page.locator('.doc-actions .ant-dropdown-trigger').click();
      await page.getByRole('menuitem', { name: kind === 'docx' ? /Xuất Word/ : /Xuất Excel/ }).click();
    },
    name,
  );
}

// ---------- bảng báo cáo ----------
/** Đọc bảng báo cáo (ReportTable) đang hiện: tiêu đề cột + các dòng + dòng tổng. */
async function readReport(scope, { allowEmpty = false, waitFor } = {}) {
  const table = scope.locator('.report-table').last();
  await expect(table.locator('.ant-spin-spinning')).toHaveCount(0);
  if (waitFor) await expect(table.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: waitFor }).first()).toBeVisible();
  if (!allowEmpty) await expect(table.locator('.ant-table-tbody tr.ant-table-row').first()).toBeVisible();
  const headers = await table
    .locator('.ant-table-thead th:not(.ant-table-cell-scrollbar)')
    .evaluateAll((ths) => ths.map((t) => t.textContent.trim()));
  const rows = await table
    .locator('.ant-table-tbody tr.ant-table-row')
    .evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
  const sum = await table.locator('.sum-row td').evaluateAll((tds) => tds.map((td) => td.textContent.trim()));
  const obj = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h || `c${i}`, r[i]])));
  const sumObj = Object.fromEntries(headers.map((h, i) => [h || `c${i}`, sum[i]]));
  return { headers, rows, obj, sum: sumObj, sumCells: sum };
}

/**
 * Nút "In" trong ngăn kéo chi tiết: chặn hộp in thật của trình duyệt, kiểm lúc gọi in thì chỉ ngăn kéo này được đánh dấu in;
 * giả lập chế độ in (CSS @media print): nội dung ngăn kéo (có `mustText`) hiện, màn phía sau ẩn.
 */
async function checkDrawerPrint(page, drawer, mustText) {
  await page.evaluate(() => {
    window.__printCalls = [];
    window.print = () => window.__printCalls.push({ body: document.body.className, marked: document.querySelectorAll('.print-this').length });
  });
  await drawer.getByRole('button', { name: /^(printer )?In$/ }).click();
  const calls = await page.evaluate(() => window.__printCalls);
  expect(calls.length).toBe(1);
  expect(calls[0].body).toContain('printing-drawer');
  expect(calls[0].marked).toBe(1);
  await page.emulateMedia({ media: 'print' });
  try {
    await expect(drawer.getByText(mustText).first()).toBeVisible();
    await expect(page.locator('.ant-layout-sider, aside').first()).toBeHidden();
    await expect(page.locator('.list-page .page-header, .list-page h2').first()).toBeHidden();
  } finally {
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  }
  await expect(page.locator('body')).not.toHaveClass(/printing-drawer/);
}

/** Ngăn kéo chi tiết trên cùng (Drawer). */
function topDrawer(page) {
  return page.locator('.ant-drawer-open .ant-drawer-content-wrapper').last();
}

module.exports = {
  shot,
  vnNum,
  money,
  login,
  menu,
  clickMenu,
  toast,
  dialog,
  selectByTyping,
  selectOption,
  clearSelect,
  setRange,
  focused,
  newDocByF2,
  setDocDate,
  pickPartner,
  pickWarehouse,
  focusBlankCode,
  typeLine,
  readLines,
  enterDoc,
  enterVoucher,
  footerSum,
  saveDraft,
  postDoc,
  blurAll,
  download,
  exportDoc,
  readReport,
  topDrawer,
  checkDrawerPrint,
};
