# Lab

## search.py: tìm từ khóa trên các nguồn mở

```bash
pip install -r requirements.txt
python search.py "mật ong"                              # in kết quả ra màn hình
python search.py "mật ong" --limit 20 --out kq.csv      # lưu CSV (mở được bằng Excel)
python search.py "mật ong" --sources gnews,wiki --out kq.json
```

| Nguồn    | Ghi chú |
|----------|---------|
| `gnews`  | Google News RSS, không cần khóa |
| `google` | Google Custom Search API, cần khóa (xem bên dưới), miễn phí 100 lượt/ngày |
| `wiki`   | Wikipedia (`--lang vi` hoặc `en`, ...) |
| `ddg`    | DuckDuckGo, có thể bị chặn nếu gọi nhiều |

Một nguồn bị lỗi thì script bỏ qua nguồn đó và chạy tiếp. Kết quả trùng URL được loại bỏ.

### Bật tìm kiếm Google

1. Tạo Programmable Search Engine tại https://programmablesearchengine.google.com, chọn "Search the entire web", rồi lấy **Search engine ID**.
2. Tạo API key tại https://console.cloud.google.com, bật "Custom Search API".
3. Đặt biến môi trường trước khi chạy script:
   ```bash
   export GOOGLE_API_KEY=...
   export GOOGLE_CSE_ID=...
   ```

## monitor.py: giám sát lộ lọt và tự động báo cáo

> **Chạy trên máy được đơn vị phê duyệt.** Mọi dấu hiệu trong watchlist đều được gửi tới máy tìm kiếm bên ngoài. Không đưa nội dung tài liệu mật vào watchlist; chỉ dùng những dấu hiệu đã được cấp có thẩm quyền đồng ý.
> Công cụ **không tải nội dung** trang hay tài liệu tìm thấy, chỉ ghi lại URL, tiêu đề, đoạn trích và thời điểm.

```bash
# watchlist.txt: mỗi dòng một dấu hiệu, dòng bắt đầu bằng # là chú thích
python monitor.py watchlist.txt
python monitor.py watchlist.txt --sites example.gov.vn,drive.google.com
```

Mỗi lần chạy, công cụ chỉ báo các phát hiện **mới** (danh sách đã thấy lưu trong `monitor_state.json`). Khi có phát hiện mới, công cụ sẽ:
1. Ghi thêm vào `phat_hien.csv`.
2. Tạo file báo cáo trong `bao_cao/bao_cao_<thời điểm>.txt`.
3. Gửi email nếu đã cấu hình máy chủ thư **nội bộ** của đơn vị:
   ```bash
   export SMTP_HOST=mail.donvi.local SMTP_PORT=587 SMTP_USER=... SMTP_PASS=...
   export REPORT_FROM=giamsat@donvi.local REPORT_TO=canbo@donvi.local
   ```
4. Thoát với mã `2`, để cron hoặc hệ thống giám sát có thể nhận biết.

Chạy tự động mỗi giờ bằng cron:
```
0 * * * * cd /duong/dan/Lab && python3 monitor.py watchlist.txt >> monitor.log 2>&1
```

## fps/: BRICKYARD, a small browser FPS

A tiny first-person shooter (three.js, photoscanned CC0 assets, no build step). See [fps/README.md](fps/README.md).

```bash
cd fps && python3 -m http.server 8000   # then open http://localhost:8000
```
