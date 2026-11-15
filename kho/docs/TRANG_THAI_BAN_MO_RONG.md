# TRẠNG THÁI BẢN MỞ RỘNG — TẠM DỪNG NGÀY 15/11/2026

Tạm dừng theo yêu cầu để ưu tiên cho khách dùng thử **bản chuẩn**. File này ghi lại đã làm tới đâu để sau này làm tiếp.

## Bản chuẩn (đúng 91 đầu việc) — DÙNG ĐƯỢC, đây là bản đưa khách dùng thử
- Không bị ảnh hưởng bởi phần mở rộng: mọi tính năng mở rộng mặc định TẮT; tắt thì chạy y như cũ.
- Lần kiểm gần nhất trên mã hiện tại (tính năng tắt): test Go đạt hết; QA qua API 45/45; bộ trình duyệt 168/168
  (lần chạy 168/168 gần nhất là với backend M3 + giao diện M2; giao diện M3 làm dở CHƯA được chạy lại bộ này).
- Bộ cài: `setup/dong-goi.sh`. **Bộ cài bản chuẩn phải đóng từ giao diện đã kiểm (commit `3cf2aa3`), không đóng từ
  giao diện M3 đang dở.** Gói Windows và Linux đã gửi được đóng theo cách đó.

## Bản mở rộng — CHƯA XONG, chưa đưa khách
Đặc tả: `docs/SPEC_MO_RONG.md`. Quyết định: `docs/QUYET_DINH.md` mục N–Q. API: `docs/API.md` §8–§11.

| Đợt | Nội dung | Backend | Kiểm thử độc lập qua API | Giao diện | Kiểm thử trình duyệt |
|---|---|---|---|---|---|
| M1 | Bật/tắt tính năng, phân quyền (C1), khóa sổ (C4), nhập Excel (C3) | Xong | Đạt | Xong | Chưa làm |
| M2 | Tồn tối thiểu (C5), giá theo khách (C6), hạn mức + tuổi nợ (C8), lãi gộp (C7) | Xong | Đạt | Xong | Chưa làm |
| M3 | Kiểm kê (C9), quy đổi đơn vị (C10), thuế GTGT (C11), mẫu in (C12), HTTPS (C13) | Xong, còn 1 việc dở | Còn 1 test hỏng | Làm dở, chưa kiểm | Chưa làm |

### Việc đang dở lúc dừng
1. **Backend – quy tắc mã dòng khi lưu lại phiếu (lỗi M-19, M-20 của QA vòng 5).** Agent đã viết xong bản sửa nhưng chưa
   chạy đủ cổng kiểm và chưa cập nhật tài liệu. Em chạy lại sau khi dừng: test Go đạt, QA bản chuẩn 45/45, QA bản mở rộng
   **147/148** — test hỏng: `test_RT_C1_masked_user_every_route_to_change_a_stored_price` (1 phép kiểm). Chưa phân tích
   đây là lỗi của bản sửa hay test cần theo quy tắc mới. Chưa có test kiểu ngẫu nhiên em đã yêu cầu cho quy tắc này.
   Quy tắc cần đạt: mã dòng chỉ hợp lệ khi thuộc phiếu, xuất hiện lần đầu, và đúng mặt hàng; ngoài ra coi như dòng mới;
   không bao giờ để mất thuế / đơn vị quy đổi một cách âm thầm.
2. **Giao diện M3** (kiểm kê, đơn vị trên phiếu, cột thuế, mẫu in, nhật ký thay đổi, sửa tràn ngang báo cáo tuổi nợ):
   mã đã viết, `tsc` và build sạch, nhưng agent chưa chạy kiểm tra trên trình duyệt và chưa báo cáo. **Coi như chưa kiểm.**
3. **Chưa làm:** kiểm thử độc lập trên trình duyệt cho toàn bộ giao diện mở rộng (M1–M3); chạy lại bộ 168 test bản chuẩn
   với giao diện M3; bộ cài bản mở rộng (`KHO_EDITION=extended`); cập nhật ma trận nghiệm thu cho phần mở rộng.

### Điểm đặc tả còn hở, cần khách trả lời (đã ghi trong QUYET_DINH mục Q)
Giá riêng của khách theo đơn vị nào; phân biệt "không chịu thuế" và "không khai thuế"; giá vốn có gồm thuế đầu vào không
(phương pháp trực tiếp); phương pháp giá vốn bình quân sau mỗi lần nhập; logo trong file Excel/Word.

### Cách chạy thử bản mở rộng trên máy phát triển
```bash
cd kho/backend && DATABASE_URL=postgres://kho:kho@127.0.0.1:5432/kho_mr LISTEN_ADDR=:8090 KHO_EDITION=extended ./bin/khoserver
cd kho/qa && ./run_mr.sh        # QA bản mở rộng (hiện 147/148)
```

## Việc nên làm cho bản chuẩn trước khi cho dùng thử qua Internet
- **Giới hạn số lần đăng nhập sai** (hiện chưa có) — rủi ro dò mật khẩu khi máy chủ có IP công khai.
- Cài bằng chế độ HTTPS của bộ cài Linux (`TEN_MIEN=…`), không mở cổng 8080 ra ngoài; lệnh cài này chưa được chạy thử
  trên máy có systemd.
- Đặt mật khẩu mạnh cho mọi tài khoản dùng thử; sao lưu ra ngoài máy chủ.
