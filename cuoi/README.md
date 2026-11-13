# Nói Dối Như Cuội

Game "ức chế" nhỏ chạy trên trình duyệt. Đêm rằm, Bé Sao (một chiếc đèn ông sao) lạc đường về hội.
Chú Cuội ngồi trên cung trăng chỉ đường, và gần như câu nào cũng là nói dối: sàn sập, chông mọc, quà nổ, cổng hội bỏ chạy.
Tám màn ngắn, ngã là hồi sinh ngay. Đến màn 7, Cuội nói thật một lần.

## Chạy

Mở `index.html` bằng trình duyệt là chơi được (không cần cài đặt, không cần máy chủ). Chơi được cả trên điện thoại bằng nút cảm ứng.

| Phím | Tác dụng |
|------|----------|
| `←` `→` hoặc `A` `D` | đi |
| `Space` (hoặc `↑`, `W`) | nhảy, giữ lâu để nhảy cao |
| `R` | thử lại màn |
| `M` | tắt / bật tiếng |

Tiến độ được lưu trong trình duyệt.

## Kỹ thuật

- Một file `game.js`, vẽ bằng Canvas 2D. Toàn bộ hình ảnh (trời đêm, trăng, phố đèn lồng, nhân vật) và âm thanh (nhạc ngũ cung, hiệu ứng) đều sinh bằng code, không có file ảnh hay file tiếng.
- Vật lý chạy bước cố định 120 Hz nên kết quả lặp lại được. `window.__cuoi.step(n, {left, right, jump})` cho phép chạy thử bằng kịch bản; cả 8 màn đã được một bot đi hết để chắc chắn màn nào cũng qua được.
- Phông chữ Be Vietnam Pro tải từ Google Fonts; không có mạng thì dùng phông hệ thống.

## Bản 3D

Có thêm bản góc nhìn thứ nhất với đồ hoạ 3D: `fps/cuoi.html` (cần chạy qua máy chủ tĩnh, xem `fps/README.md`).
