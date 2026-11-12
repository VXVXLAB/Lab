# Rút kinh nghiệm: 5 lớp kỹ thuật trước khi nghĩ tới "nhà máy phần mềm"

Nguồn: bài viết về quan điểm của Lauren Tan (@poteto): *không cần Software Factory, cần kỹ thuật phần mềm tốt và dùng token AI đúng chỗ.*

Tài liệu này không tóm tắt lại bài viết. Nó soi 5 lớp đó vào chính repo này (`search.py`, `monitor.py`) để xem ta đang thiếu gì và nên làm gì trước.

## Ý chính cần nhớ

AI làm tăng tốc độ viết code, nên nó khuếch đại cả nền tảng tốt lẫn nền tảng yếu. Thứ tự đầu tư hợp lý là từ rẻ và chắc chắn đến đắt và mơ hồ:

1. **Codebase**: code có tổ chức thì AI (và người) sửa đúng chỗ.
2. **Static analysis**: việc gì kiểm tra được bằng quy tắc thì giao cho linter, type checker, CI. Không tốn token, kết quả lặp lại được.
3. **Verification**: "chạy được" khác "đúng". Phải có test chứng minh hành vi quan trọng.
4. **Prose**: một file hướng dẫn rõ ràng (`AGENTS.md`) thường hữu ích hơn thêm agent.
5. **Human review**: mức kiểm duyệt tương xứng mức rủi ro; trách nhiệm cuối cùng vẫn là của người.

Độ phức tạp (multi-agent, pipeline tự động) chỉ nên thêm khi nó giải quyết một vấn đề cụ thể mà 5 lớp trên chưa giải quyết được.

## Soi vào repo này

| Lớp | Hiện trạng | Đánh giá |
|-----|-----------|----------|
| Codebase | 2 file, chung một giao diện nguồn tìm (`SOURCES`) | Khá, còn vài chỗ lệch |
| Static analysis | Không có cấu hình linter, type checker, CI | Thiếu |
| Verification | Không có test nào | Thiếu, rủi ro lớn nhất |
| Prose | README tốt cho người dùng; chưa có `AGENTS.md` | Thiếu một nửa |
| Human review | Chưa có quy ước | Thiếu |

### 1. Codebase

Điểm tốt: mọi nguồn tìm có cùng chữ ký `fn(q, limit, lang)` và trả về cùng một dạng `{title, url, snippet, date}`, nên `monitor.py` dùng lại được `SOURCES` mà không cần biết chi tiết từng nguồn. Thêm nguồn mới chỉ cần sửa một chỗ.

Chỗ lệch:

- `search_ddg` gọi thẳng `requests.post` (`search.py:99-102`) thay vì đi qua một hàm chung như `_get`. Sau này muốn thêm retry hay giới hạn tốc độ sẽ phải sửa hai nơi.
- `monitor.py` bỏ qua nguồn không hợp lệ mà không báo (`monitor.py:109`), trong khi `search.py` có cảnh báo. Gõ sai `--sources gogle` thì công cụ giám sát chạy thiếu nguồn và vẫn im lặng.
- Ngôn ngữ bị gắn cứng là `"vi"` (`monitor.py:118`).
- `main()` của `monitor.py` (`monitor.py:93-153`) gộp cả dựng truy vấn, lọc trùng, ghi file, báo cáo, gửi thư. Phần logic lọc "phát hiện mới" không tách ra thành hàm thuần nên không viết test được nếu không gọi mạng.
- `requirements.txt` không ghim phiên bản, hai lần cài có thể ra hai môi trường khác nhau.

### 2. Static analysis

Chạy thử `ruff check --select E,F,W,B --line-length 100 .` chỉ ra 2 lỗi nhỏ, đều ở `monitor.py`: biến tên `l` dễ nhầm (dòng 83) và một dòng quá dài (dòng 103). Không có lỗi logic nào bị bắt.

Bài học: linter rẻ và nên bật, nhưng trên repo này nó không tìm ra vấn đề nào đáng kể. Các vấn đề thật nằm ở lớp 3.

### 3. Verification

Đây là lớp đáng đầu tư nhất, vì `monitor.py` là công cụ giám sát: lỗi nguy hiểm nhất của nó là **im lặng khi lẽ ra phải báo**. Đọc code thấy các trường hợp sau, hiện chưa có test nào che:

| Tình huống | Điều xảy ra | Vị trí |
|-----------|-------------|--------|
| Ghi `phat_hien.csv` hoặc báo cáo bị lỗi (ví dụ file đang mở trong Excel) | State đã được lưu trước đó, nên các phát hiện này bị coi là "đã thấy" và **không bao giờ được báo lại** | `monitor.py:130-131` chạy trước `134-144` |
| Tất cả nguồn đều lỗi (mất mạng, bị chặn, hết quota) | In "Không có phát hiện mới", thoát mã `0`, giống hệt một lần quét sạch | `monitor.py:119-121`, `153` |
| Tiến trình bị ngắt giữa lúc ghi state | File JSON hỏng, lần chạy sau `load_state` ném lỗi và cron dừng hẳn | `monitor.py:86-90`, `130-131` |
| Tiêu đề hoặc đoạn trích từ web bắt đầu bằng `=`, `+`, `-`, `@` | Excel coi ô đó là công thức khi mở CSV (CSV injection); dữ liệu này do bên ngoài kiểm soát | `search.py:163-166`, `monitor.py:135-139` |
| Cùng một trang nhưng URL khác tham số theo dõi hoặc dấu `/` cuối | Bị báo là phát hiện mới nhiều lần | `monitor.py:123-124` |

Đúng như ví dụ "hệ thống bán hàng" trong bài: chạy demo với một watchlist thì mọi thứ trông ổn, các lỗi trên chỉ lộ ra trong điều kiện thực tế.

### 4. Prose

README đã ghi các nguyên tắc quan trọng: chạy trên máy được phê duyệt, không tải nội dung tài liệu, chỉ dùng SMTP nội bộ, watchlist không đưa vào git. Nhưng đó là hướng dẫn cho *người dùng*. Một agent sửa code không có chỗ nào nói rõ rằng đây là các ràng buộc không được phá, ví dụ không được thêm tính năng tải nội dung trang về "cho tiện".

### 5. Human review

Các phần cần người duyệt kỹ trước khi gộp: mọi thay đổi làm tăng dữ liệu gửi ra ngoài (truy vấn, nguồn tìm mới), phần gửi thư và xử lý `SMTP_PASS`, và logic quyết định cái gì là "phát hiện mới". Phần còn lại (định dạng in, thông báo) có thể duyệt nhẹ.

## Việc nên làm, theo thứ tự ưu tiên

1. **Sửa thứ tự ghi trong `monitor.py`**: ghi CSV và báo cáo xong mới lưu state, và ghi state kiểu nguyên tử (ghi file tạm rồi `os.replace`). Đây là lỗi mất dữ liệu.
2. **Phân biệt "quét sạch" với "quét hỏng"**: nếu mọi nguồn đều lỗi thì thoát bằng mã khác `0` để cron cảnh báo được.
3. **Tách logic lọc phát hiện mới thành hàm thuần** rồi viết test cho 5 tình huống ở bảng trên, dùng nguồn giả thay cho gọi mạng.
4. **Vô hiệu hóa công thức khi ghi CSV** (thêm `'` trước ô bắt đầu bằng `=`, `+`, `-`, `@`).
5. **Thêm `AGENTS.md`** ghi các ràng buộc ở lớp 4 và lệnh kiểm tra phải chạy trước khi xong việc.
6. **Bật ruff và chạy test trong CI**, ghim phiên bản trong `requirements.txt`.

Mục 1-4 là sửa hành vi; mục 5-6 là dựng hàng rào để lỗi tương tự không quay lại.

## Kết luận

Repo này không cần thêm agent. Nó cần khoảng một chục test và hai chỗ sửa thứ tự ghi file. Đó cũng chính là luận điểm của bài viết: câu hỏi nên đặt ra là *làm sao biết code này đúng*, trước khi hỏi *làm sao sinh ra nhiều code hơn*.
