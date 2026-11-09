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
