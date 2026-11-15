// Thử phím tắt bằng PHÍM THẬT mức hệ điều hành trên Chromium có cửa sổ (không headless).
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const ui = require('../lib/ui.js');
const DIR = __dirname;
const key = (...k) => execSync(`python3 ${DIR}/key.py ${k.map((x) => `'${x}'`).join(' ')}`, { env: process.env });
const snap = (n) => execSync(`import -window root ${DIR}/${n}.png`, { env: process.env });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const rec = (phim, mongDoi, ok, ghiChu = '') => { out.push({ phim, mongDoi, ok, ghiChu }); console.log(`${ok ? 'ĐẠT ' : 'HỎNG'} | ${phim} | ${mongDoi} ${ghiChu ? '| ' + ghiChu : ''}`); };
const focused = (p) => p.evaluate(() => document.hasFocus());
const vis = async (loc, t = 2500) => { try { await loc.first().waitFor({ state: 'visible', timeout: t }); return true; } catch { return false; } };

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--window-size=1366,768', '--window-position=0,0', '--no-first-run'] });
  const ctx = await browser.newContext({ viewport: null, baseURL: 'http://localhost:8080', locale: 'vi-VN' });
  const page = await ctx.newPage();

  // ---- ĐỐI CHỨNG: trang trống không có phần mềm => trình duyệt PHẢI giành phím (chứng minh phép thử bắt được)
  await page.goto('data:text/html,<title>trang trong</title><input id=a autofocus><p>trang doi chung</p>');
  key('click:600,400'); await sleep(300);
  await page.locator('#a').click(); key('type:ab'); await sleep(300);
  const v0 = await page.locator('#a').inputValue();
  key('F6'); await sleep(500); key('type:zz'); await sleep(300);
  const v1 = await page.locator('#a').inputValue();
  snap('doi-chung-F6');
  rec('ĐỐI CHỨNG F6 (trang trống)', 'trình duyệt giành phím: chữ gõ sau F6 không vào ô của trang', v0 === 'ab' && v1 === 'ab', `ô của trang: "${v0}" → "${v1}"`);
  key('Escape'); key('Escape'); key('click:600,400'); await sleep(300);
  const n0 = ctx.pages().length; key('ctrl+t'); await sleep(800); const n1 = ctx.pages().length;
  rec('ĐỐI CHỨNG Ctrl+T', 'trình duyệt mở thẻ mới', n1 === n0 + 1, `số thẻ ${n0} → ${n1}`);
  for (const p of ctx.pages()) if (p !== page) await p.close();
  await page.bringToFront(); await sleep(300);

  // ---- PHẦN MỀM
  await page.goto('/'); await ui.login(page, 'lan', '123456');
  await ui.menu(page, 'Bán hàng', 'Phiếu bán');
  key('click:700,500'); await sleep(300);
  key('F3'); await sleep(500); snap('F3');
  let tag = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
  rec('F3 (danh sách)', 'con trỏ vào ô tìm kiếm của phần mềm, trình duyệt không mở "Tìm trong trang"', tag === 'INPUT' && (await focused(page)), `phần tử đang focus=${tag}`);
  key('Escape'); await page.evaluate(() => document.activeElement && document.activeElement.blur());
  key('slash'); await sleep(400);
  tag = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
  rec('/ (danh sách)', 'con trỏ vào ô tìm kiếm', tag === 'INPUT', `focus=${tag}`);
  key('Escape'); await page.evaluate(() => document.activeElement && document.activeElement.blur());

  key('F2'); await sleep(800);
  rec('F2 (danh sách)', 'mở phiếu bán mới', /\/chung-tu\/moi/.test(page.url()), page.url().replace('http://localhost:8080', ''));

  // nhập khách + 2 dòng hàng (dùng trợ giúp của bộ E2E cho phần chuẩn bị)
  await page.locator('#partner').click(); key('type:thanh cong'); await sleep(1500); snap('go-khach');
  key('Return'); await sleep(700);
  const kh = await page.locator('.hf-partner .ant-select-selection-item').innerText().catch(() => '');
  rec('Gõ tên khách bằng phím thật + Enter', 'chọn đúng khách Thành Công', /Thành Công/.test(kh), `đã chọn: ${kh}`);
  await ui.focusBlankCode(page); await sleep(300);
  key('type:k701832', 'Return'); await sleep(500); key('type:1', 'Return'); await sleep(300); key('type:50000', 'Return'); await sleep(500);
  key('type:cos10', 'Return'); await sleep(500); key('type:2', 'Return'); await sleep(300); key('type:30000', 'Return'); await sleep(500);
  const typed = (await ui.readLines(page)).map((l) => `${l.code}:${l.qty}`);
  rec('Nhập 2 dòng hàng chỉ bằng phím thật (mã, Enter, SL, Enter, giá, Enter)', '2 dòng K701832 và COS10', typed.length === 2, typed.join(' | '));
  const before = (await ui.readLines(page)).map((l) => l.code);
  // đứng ở ô mã của dòng 1
  await page.locator('.line-grid tbody tr input.code-input').first().click(); await sleep(300);

  key('F6'); const d6 = await vis(ui.topDrawer(page)); const f6 = await focused(page); snap('F6');
  const t6 = d6 ? (await ui.topDrawer(page).innerText()).slice(0, 60).replace(/\n/g, ' ') : '';
  rec('F6 (dòng hàng)', 'mở thẻ kho của mặt hàng; KHÔNG nhảy lên thanh địa chỉ', d6 && f6, `ngăn="${t6}" trang còn focus=${f6}`);
  key('Escape'); await sleep(600);
  await page.locator('.line-grid tbody tr input.code-input').first().click(); await sleep(300);
  key('F7'); const d7 = await vis(ui.topDrawer(page)); snap('F7');
  const t7 = d7 ? (await ui.topDrawer(page).innerText()).slice(0, 60).replace(/\n/g, ' ') : '';
  rec('F7 (dòng hàng)', 'mở lịch sử bán; KHÔNG hiện hộp "Caret Browsing"', d7 && (await focused(page)), `ngăn="${t7}"`);
  key('Escape'); await sleep(600);

  await page.locator('.line-grid tbody tr input.code-input').first().click(); await sleep(300);
  key('alt+Down'); await sleep(500);
  const afterMove = (await ui.readLines(page)).map((l) => l.code);
  rec('Alt+↓', 'dời dòng 1 xuống dưới', afterMove[0] === before[1] && afterMove[1] === before[0], `${before.join(',')} → ${afterMove.join(',')}`);
  key('ctrl+Insert'); await sleep(500);
  const nIns = (await page.locator('.line-grid tbody tr').count());
  key('ctrl+Delete'); await sleep(500);
  const nDel = (await page.locator('.line-grid tbody tr').count());
  rec('Ctrl+Insert / Ctrl+Delete', 'chèn rồi xóa một dòng', nDel === nIns - 1 || nDel < nIns, `số hàng lưới ${nIns} → ${nDel}`);

  key('ctrl+s'); await sleep(1500); snap('CtrlS');
  const saved = /\/chung-tu\/\d+/.test(page.url());
  rec('Ctrl+S', 'lưu phiếu tạm; KHÔNG hiện hộp "Lưu trang web"', saved && (await focused(page)), page.url().replace('http://localhost:8080', ''));

  key('F9'); await sleep(600);
  // có thể hỏi xác nhận bán lỗ / ghi sổ
  for (let i = 0; i < 3; i++) { const b = page.getByRole('button', { name: /Vẫn ghi sổ|Đồng ý|Ghi sổ$/ }).last(); if (await page.getByRole('dialog').first().isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(600); } }
  const posted = await vis(page.getByText(/XK\d{5}/), 4000); snap('F9');
  rec('F9', 'ghi sổ phiếu (ra số XK…)', posted);
  key('click:700,300'); await page.evaluate(() => document.activeElement && document.activeElement.blur());
  key('F8'); const editing = await vis(page.getByText(/ĐANG SỬA/i), 3000); snap('F8');
  rec('F8', 'vào chế độ sửa phiếu đã ghi sổ', editing);

  // F5: hành vi của trình duyệt (tải lại) — phần mềm phải giữ được phiên
  key('F5'); await sleep(2500);
  rec('F5', 'trình duyệt tải lại trang; vẫn đăng nhập, vẫn ở phiếu đó', /\/chung-tu\/\d+/.test(page.url()) && (await vis(page.getByRole('button', { name: 'Tài khoản', exact: true }), 5000)));

  await ui.menu(page, 'Bán hàng', 'Phiếu bán'); key('click:700,500'); await page.evaluate(() => document.activeElement && document.activeElement.blur()); key('F2'); await sleep(1000);
  // F4 thêm khách ngay trong phiếu
  key('F4'); const dlg = await vis(page.getByRole('dialog'));
  snap('F4'); rec('F4 (trong phiếu)', 'mở hộp thêm khách hàng', dlg);
  key('Escape'); await sleep(500);
  rec('Esc', 'đóng hộp thêm khách', !(await page.getByRole('dialog').first().isVisible().catch(() => false)));


  require('fs').writeFileSync(`${DIR}/ket-qua.json`, JSON.stringify(out, null, 1));
  await browser.close();
  console.log(`\n${out.filter((o) => o.ok).length}/${out.length} đạt`);
})().catch((e) => { console.error('LỖI SCRIPT:', e.message.split('\n')[0]); process.exit(1); });
