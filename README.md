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

## DroidLite: giả lập Android siêu nhẹ trên Windows

DroidLite là phần quản lý nhẹ bọc quanh **lõi Android Emulator chính thức của Google**. Nó không tự giả lập CPU hay GPU; nó thay thế Android Studio, `sdkmanager` và `avdmanager` bằng vài trăm dòng Python:

- Không cần Android Studio, không cần Java, không cần thư viện Python ngoài (chỉ cần Python 3.9 trở lên).
- Tự tải lõi giả lập, `adb` và ảnh hệ thống thẳng từ kho của Google, có kiểm tra mã băm.
- Hỗ trợ Android 2.3 đến bản mới nhất (API 10 đến 37), ba loại ảnh: AOSP gốc (nhẹ nhất), Google APIs, Google Play.
- Mọi dữ liệu nằm trong `%LOCALAPPDATA%\DroidLite` (đổi bằng biến `DROIDLITE_HOME` hoặc `--home`).

### Bắt đầu

Nhấp đúp `droidlite.bat` (hoặc chạy `python -m droidlite`). Bảng điều khiển mở trong trình duyệt:

1. Bấm **Cài lõi giả lập** (khoảng 450 MB), đọc và chấp nhận giấy phép Android SDK.
2. Ở mục **Phiên bản Android**, bấm **Tải về** phiên bản cần dùng.
3. Ở mục **Máy ảo**, đặt tên, chọn phiên bản, bấm **Tạo**, rồi bấm **Chạy**.

Để máy ảo chạy nhanh, Windows cần bật tăng tốc ảo hóa: mở "Turn Windows features on or off", bật **Windows Hypervisor Platform**, khởi động lại. Nút **Kiểm tra máy** cho biết tăng tốc đã sẵn sàng chưa. Không có tăng tốc thì máy ảo vẫn chạy nhưng rất chậm.

### Tính năng

| Nhóm | Có gì |
|------|-------|
| Quản lý | Nhiều máy ảo, chạy song song, chọn RAM, số nhân, kiểu màn hình, GPU thật hoặc phần mềm, khởi động nguội, xóa dữ liệu, chạy ẩn cửa sổ |
| Điều khiển | Cài APK, chụp và quay màn hình, phím Back/Home/Đa nhiệm/Nguồn/Âm lượng, xoay, gõ văn bản, mở liên kết |
| Giả lập | GPS, pin, tốc độ và độ trễ mạng, SMS và cuộc gọi đến, vân tay, snapshot (lưu, khôi phục, xóa) |
| Cửa sổ ADB | Gõ lệnh `adb` cho máy đang chọn, có lịch sử lệnh và nút lệnh nhanh; thẻ Logcat chạy liên tục, lọc theo ứng dụng, mức độ, từ khóa |
| Debug | Bật và tắt `frida-server` (tự tải đúng phiên bản và kiến trúc), đặt và gỡ proxy HTTP, `adb root` |

Frida cần ảnh AOSP hoặc Google APIs (ảnh Google Play không có root) và `pip install frida-tools` trên máy thật. DroidLite tải `frida-server` cùng phiên bản với thư viện `frida` đang cài; nếu chưa cài thì lấy bản mới nhất.

### Dòng lệnh

```bat
python -m droidlite doctor                 & rem kiểm tra máy
python -m droidlite setup                  & rem tải lõi giả lập và adb
python -m droidlite images                 & rem liệt kê phiên bản Android
python -m droidlite install 34             & rem tải Android 14 (AOSP)
python -m droidlite install 34 --tag google_apis_playstore
python -m droidlite create may1 34 --ram 2048 --cores 2
python -m droidlite start may1 --wait
python -m droidlite apk may1 app.apk
python -m droidlite adb may1 shell         & rem shell tương tác
python -m droidlite shot may1
python -m droidlite stop may1
```

### An toàn

Bảng điều khiển chỉ nghe trên `127.0.0.1`, mỗi lần chạy sinh một mã phiên ngẫu nhiên nằm trong địa chỉ, và từ chối mọi yêu cầu sai mã hoặc sai tên máy chủ. Đừng chia sẻ địa chỉ có `?t=...` cho người khác khi bảng điều khiển đang chạy.

### Kiểm thử

```bash
python -m unittest tests.test_droidlite
```

Bộ test dùng kho gói giả và `adb` giả nên không cần mạng hay máy ảo thật.
