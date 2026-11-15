# Thử phím tắt bằng phím thật (mức hệ điều hành)

Bộ E2E chính bơm phím thẳng vào trang nên không biết trình duyệt có giành phím (F3, F6, F7, Ctrl+S…) hay không.
Phép thử này mở Chromium **có cửa sổ** trên màn hình ảo và gửi phím qua X11 XTEST, đi qua cả phần khung trình duyệt.
Có hai bước đối chứng (F6 trên trang trống, Ctrl+T) để chắc phép thử bắt được khi trình duyệt giành phím.

Cần: Linux, `Xvfb`, `pip install python-xlib`, máy chủ demo chạy ở :8080 (dữ liệu `seeddemo`).

```bash
Xvfb :99 -screen 0 1366x768x24 &
cd kho/e2e/phim-that && DISPLAY=:99 node thu-phim-that.cjs
```
Kết quả 15/11/2026 (Chromium của Playwright, Linux): 17/17 đạt. Ảnh chụp cả cửa sổ ra cùng thư mục (`*.png`, không đưa vào git).
Chưa thử: Chrome/Edge trên Windows, bộ gõ Unikey.
