// Kiểm tra tổng hợp cuối lần chạy: trong TOÀN BỘ các câu chuyện trước (mọi máy/ngữ cảnh), trình duyệt không có lỗi
// JavaScript, không có phản hồi 5xx, và không có lỗi console nào ngoài các dòng "Failed to load resource" mà Chrome tự in
// cho phản hồi 4xx. Dữ liệu do lib/fixtures.js ghi vào out/browser-issues.jsonl.
//
// Về các dòng 4xx: máy chủ dùng mã HTTP cho các câu trả lời nghiệp vụ ĐÚNG THIẾT KẾ (docs/API.md): 422 thiếu hàng,
// 409 cảnh báo bán lỗ / máy khác vừa sửa, 401 chưa đăng nhập / phiên hết hạn. Chrome luôn in các phản hồi này ra console
// dưới dạng lỗi; người dùng không thấy. Chúng được liệt kê riêng (ghi chú kết quả) và tính là phát hiện mức thấp F-06.
// Riêng các 404 xảy ra ngay sau khi xóa phiếu tạm được kiểm ở câu chuyện 5 (phát hiện F-06).
const fs = require('fs');
const { test, expect, ISSUES } = require('../lib/fixtures');
const { BASE_URL } = require('../lib/env');

function readIssues() {
  if (!fs.existsSync(ISSUES)) return [];
  return fs
    .readFileSync(ISSUES, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const http4xx = (i) => i.kind === 'console' && /^Failed to load resource: the server responded with a status of 4\d\d\b/.test(i.text);

test('REQ-UX Toàn bộ lần chạy: không lỗi JavaScript, không phản hồi 5xx, không lỗi console (ngoài dòng 4xx tự in của Chrome)', async () => {
  const issues = readIssues();
  const real = issues.filter((i) => !http4xx(i));
  const summary = real.map((i) => `[${i.kind}] ${i.test} (${i.machine}): ${i.text.slice(0, 300)} ${i.url ?? ''}`);
  // thống kê các dòng 4xx để người đọc báo cáo thấy
  const byStatus = {};
  for (const i of issues.filter(http4xx)) {
    const st = /status of (\d+)/.exec(i.text)[1];
    const ep = (i.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/\d+/g, '/{id}');
    const k = `${st} ${ep}`;
    byStatus[k] = (byStatus[k] || 0) + 1;
  }
  test.info().annotations.push({ type: 'console 4xx (đúng thiết kế, xem F-06)', description: JSON.stringify(byStatus) });
  expect(summary).toEqual([]);
});

// Vòng 2 (sau khi F-06 được sửa): KHÔNG còn 404 nào; 401 chỉ được có ở test cố ý gõ sai mật khẩu và ở các test cố ý làm
// hết phiên (tên test có "Phiên"/"F-04"); màn đăng nhập của trình duyệt mới không còn gọi /api/auth/me.
test('REQ-UX Phản hồi 4xx chỉ là mã nghiệp vụ đã thiết kế: không 404; 401 chỉ ở test sai mật khẩu / hết phiên', async () => {
  const bad = readIssues()
    .filter(http4xx)
    .filter((i) => {
      const st = Number(/status of (\d+)/.exec(i.text)[1]);
      const url = (i.url || '').replace(/^https?:\/\/[^/]+/, '');
      if (st === 401 && url === '/api/auth/login' && /Màn đăng nhập/.test(i.test)) return false; // cố ý sai mật khẩu
      if (st === 401 && /Phiên|F-04/.test(i.test)) return false; // cố ý làm hết phiên
      if ((st === 409 || st === 422) && /^\/api\/(documents\/\d+(\/post)?|vouchers\/\d+)$/.test(url)) return false; // thiếu hàng, bán lỗ, xung đột
      if (st === 404 && /^\/api\/products\/lookup\?/.test(url)) return false; // tra mã chính xác khi gõ dở — phát hiện F-16, kiểm riêng bên dưới
      return true;
    })
    .map((i) => `${i.test} (${i.machine}): ${i.text} ${i.url}`);
  expect(bad).toEqual([]);
});

// PHÁT HIỆN F-16 (BAO_CAO_E2E.md, thấp): gõ mã hàng từng chữ trong lưới phiếu, mỗi tiền tố ("K", "KT", "KT4"…) được tra
// "mã chính xác" và nhận 404 ⇒ mỗi lần gõ chậm là một dòng lỗi đỏ trong console. Người dùng không thấy, nhưng là lỗi console.
test.fail('REQ-UX F-16 Gõ mã hàng trong lưới phiếu không sinh phản hồi 404 (tra mã khi chưa gõ xong)', async () => {
  const lookups = readIssues().filter((i) => http4xx(i) && /status of 404/.test(i.text) && /\/api\/products\/lookup\?/.test(i.url || ''));
  expect(lookups.map((i) => `${i.test}: ${(i.url || '').replace(/^.*\/api/, '/api')}`)).toEqual([]);
});

test('REQ-UX Màn đăng nhập của trình duyệt chưa từng đăng nhập không gọi /api/auth/me (không lỗi 401 đỏ)', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  const calls = [];
  page.on('request', (r) => r.url().includes('/api/auth/me') && calls.push(r.url()));
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByLabel('Tên đăng nhập')).toBeVisible();
  expect({ calls, errors }).toEqual({ calls: [], errors: [] });
  await ctx.close();
});
