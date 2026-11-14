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

test('REQ-UX Các phản hồi 4xx chỉ là mã nghiệp vụ đã thiết kế (401/409/422) hoặc 404 sau khi xóa phiếu tạm (F-06)', async () => {
  const bad = readIssues()
    .filter(http4xx)
    .filter((i) => {
      const st = Number(/status of (\d+)/.exec(i.text)[1]);
      const url = (i.url || '').replace(/^https?:\/\/[^/]+/, '');
      if (st === 401) return false; // màn đăng nhập / phiên hết hạn
      if ((st === 409 || st === 422) && /^\/api\/(documents\/\d+(\/post)?|vouchers\/\d+)$/.test(url)) return false; // thiếu hàng, bán lỗ, xung đột
      if (st === 404 && /^\/api\/documents\/(\d+|check)$/.test(url)) return false; // F-06: gọi lại phiếu vừa xóa
      return true;
    })
    .map((i) => `${i.test}: ${i.text} ${i.url}`);
  expect(bad).toEqual([]);
});
