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
4. **Vô hiệu hóa công thức khi ghi CSV**: thêm ký tự tab vào đầu ô bắt đầu bằng ký tự kích hoạt công thức và bọc mọi ô trong dấu nháy kép (chi tiết ở mục "Bổ sung sau khi tra cứu").
5. **Thêm `AGENTS.md` thật ngắn**, chỉ ghi những ràng buộc không suy ra được từ code và lệnh kiểm tra phải chạy trước khi xong việc. Ràng buộc nào ép được bằng code hoặc test thì ép bằng code hoặc test trước.
6. **Bật ruff và chạy test trong CI**, ghim phiên bản trong `requirements.txt`.

Mục 1-4 là sửa hành vi; mục 5-6 là dựng hàng rào để lỗi tương tự không quay lại.

## Bổ sung sau khi tra cứu

Bản đầu của tài liệu này chỉ dựa trên bài viết tiếng Việt. Tra lại nguồn gốc thì thấy bài đó bỏ sót ý quan trọng nhất và có vài chỗ cần chỉnh. Lưu ý: bài đăng gốc trên X không tải được từ môi trường này, nên phần dưới dựa trên trích dẫn của công cụ tìm kiếm và hai bài tổng hợp của bên thứ ba; hình sơ đồ trong bài gốc chưa được xem trực tiếp.

### Ý bị bỏ sót: "càng xác định càng tốt"

Câu gốc (6/11/2026) kết thúc bằng: *"the more deterministic the better (and token efficient)"*. Năm lớp không phải là năm hạng mục ngang hàng mà là một **thang xếp từ xác định nhất đến kém xác định nhất**, kèm một quy tắc vận hành:

> Mỗi vấn đề nên được đẩy lên lớp xác định nhất có thể giữ được nó.

Thứ tự sửa lỗi mà các bài tổng hợp ghi lại: trước hết hỏi kiến trúc hoặc kiểu dữ liệu có loại bỏ được lỗi không; nếu không thì thêm lint hoặc test để CI chặn; nếu vẫn không thì mới viết thành rule hoặc skill; cuối cùng mới trông vào người duyệt. Một lời nhắc phải viết đến lần thứ hai thì nên được mã hóa thành lint, kiểm tra lúc chạy hoặc script thay vì thêm chữ.

Hệ quả là hai chỗ trong bài tiếng Việt cần hiểu lại:

- **Human review** nằm cuối vì nó đắt và kém nhất quán nhất, không phải vì nó là "chốt chặn cuối cùng". Một nhận xét review lặp đi lặp lại là dấu hiệu vấn đề đó chưa được đẩy lên lớp trên. Người vẫn chịu trách nhiệm, nhưng nên dành sức cho những gì các lớp trên không kiểm được.
- **Verification** theo nghĩa của tác giả là agent tự chạy sản phẩm thật và thu bằng chứng thực nghiệm (bà gọi đây là "hands and eyes"), rộng hơn unit test. Giới hạn bà nêu rõ: kiểm chứng chỉ cho biết code khớp đặc tả; đặc tả có đúng hay không thì chỉ người phán đoán được.

Luận điểm đi kèm trong bài nói của bà: năng suất đến từ độ tin cậy, không đến từ việc mở thêm agent. Chạy song song nhiều agent trước khi tin được từng agent chỉ tạo ra, theo lời bà, "a pile of garbage pull requests".

Các nguồn không thống nhất về vị trí của verification trong thang (một bài xếp nó sau static analysis, một bài xếp nó cuối như một kỹ năng riêng). Thứ tự của ba lớp còn lại thì nhất quán: codebase, static analysis, rồi mới đến văn bản và người duyệt.

### Áp quy tắc "đẩy lên lớp trên" vào repo này

Các ràng buộc của repo hiện phần lớn nằm ở lớp văn bản (README, docstring). Mỗi cái có thể đẩy lên:

| Ràng buộc hoặc lỗi | Đang nằm ở | Có thể đẩy lên |
|--------------------|-----------|----------------|
| Không tải nội dung trang tìm thấy | README, docstring | Test: chạy `monitor` với `requests` giả, khẳng định chỉ gọi tới các máy tìm kiếm đã liệt kê |
| Watchlist không đưa vào git | `.gitignore` | Đã ở lớp xác định, giữ nguyên |
| `--sources` gõ sai bị bỏ qua im lặng | Không ở đâu | Codebase: dùng `choices` của argparse hoặc báo lỗi và dừng ngay |
| Lưu state trước khi ghi kết quả | Không ở đâu | Codebase: gom "ghi CSV, ghi báo cáo, lưu state" vào một hàm để thứ tự sai không viết ra được; thêm test giả lập ghi lỗi |
| Quét hỏng trông như quét sạch | Không ở đâu | Codebase: đếm số nguồn thành công, bằng 0 thì thoát mã lỗi; thêm test |
| Chỉ gửi thư qua SMTP nội bộ | README | Khó ép bằng code; giữ ở `AGENTS.md` và người duyệt |

Chỉ dòng cuối thật sự cần văn bản. Điều này thay đổi cách đọc danh sách ưu tiên ở trên: `AGENTS.md` là chỗ chứa phần còn lại sau khi đã ép hết những gì ép được.

### `AGENTS.md`: bằng chứng cho thấy nên viết ít

Bài tiếng Việt nói một file hướng dẫn tốt có thể tiết kiệm đáng kể thời gian và token. Nghiên cứu của nhóm ETH Zurich (Gloaguen và cộng sự, arXiv:2602.11988) cho kết quả dè dặt hơn: file ngữ cảnh nhìn chung không làm tăng tỷ lệ hoàn thành nhiệm vụ và làm chi phí suy luận tăng trung bình hơn 20%. Agent tuân theo chỉ dẫn trong file khá tốt, nhưng phần tổng quan về repo thì không giúp ích. Kết luận của nhóm tác giả: file ngữ cảnh hữu ích để nêu các quy ước không theo chuẩn thông thường.

Áp vào đây: `AGENTS.md` của repo này không nên mô tả lại cấu trúc hai file (agent đọc code là thấy). Nó chỉ nên có vài dòng mà code không tự nói ra: không thêm tính năng tải nội dung, không mở rộng dữ liệu gửi ra ngoài khi chưa được duyệt, chỉ dùng SMTP nội bộ, và lệnh test phải chạy.

### CSV injection: sửa lại cách khắc phục

Bản đầu đề xuất thêm dấu `'` trước ô nguy hiểm. Theo trang CSV Injection của OWASP thì cách này chưa đủ:

- Danh sách ký tự kích hoạt rộng hơn: `=`, `+`, `-`, `@`, tab (`0x09`), xuống dòng (`0x0D`, `0x0A`) và các biến thể toàn chiều rộng như `＝`, `＋`, `－`, `＠`.
- Với Excel, OWASP khuyến nghị thêm ký tự **tab** vào đầu ô, bên trong trường đã bọc nháy kép. Excel có thể bỏ dấu nháy hoặc ký tự thoát khi lưu và mở lại file, làm công thức hoạt động trở lại.
- Chỉ lọc ký tự đầu là chưa đủ, vì dấu phân cách và dấu nháy có thể dùng để mở ô mới. Với module `csv` của Python nên ghi bằng `quoting=csv.QUOTE_ALL`.
- Đánh đổi: ký tự tab trở thành một phần dữ liệu. `phat_hien.csv` là hồ sơ bằng chứng, nên cần ghi rõ quy ước này để ai xử lý tiếp biết mà bỏ tab đi. File JSON không bị ảnh hưởng và có thể dùng làm bản gốc.

### Bối cảnh và ý kiến trái chiều

- Về tác giả: theo một bài tổng hợp của bên thứ ba, Lauren Tan làm khoảng sáu năm ở Meta trong nhóm React (React Compiler), chuyển sang Cursor tháng 4/2026, và gắn với SpaceX, Grok là do Cursor sau đó sáp nhập. Trang nhóm của React vẫn ghi bà là kỹ sư tại Meta, nên thông tin này chưa được kiểm chứng từ nguồn chính thức. Cách giật tít "kỹ sư từng làm tại SpaceX" vì vậy dễ gây hiểu lầm về nền tảng chuyên môn của bà, vốn là công cụ lập trình và trình biên dịch.
- Bà cũng không bác bỏ việc chạy nhiều agent: cũng theo bài tổng hợp đó, nhóm của bà gộp khoảng 2.000 PR một tháng. Điều bà phản đối là cái tên và thứ tự đầu tư.
- Matt Pocock bảo vệ thuật ngữ "Software Factory": ông thừa nhận nó bị thổi phồng nhưng cho rằng nó chỉ một thay đổi có thật.
- Một bản tin tổng hợp thuật lại rằng Zach Lloyd đo trên hệ thống của Warp thấy duyệt code đối kháng bằng AI làm chi phí tăng 140% trong khi chất lượng tăng 7,5%. Số liệu này chưa đối chiếu được với nguồn gốc; ý đáng giữ là nên tự đo trước khi thêm tầng tự động.

### Nguồn

- Bài đăng gốc của Lauren Tan: https://x.com/poteto/status/2118613050462728659
- "Trust First, Then Parallel" (tổng hợp bài nói): https://redreamality.com/blog/lauren-tan-poteto-trust-before-parallel/
- "On pstack" (Barnaby Robson): https://barnabyrobson.org/on-pstack/
- Matt Pocock về thuật ngữ Software Factory: https://x.com/mattpocockuk/status/2119748545691402733
- Bản tin X Digest ngày 6/11/2026: https://jazzy-fjord-25sc.here.now/
- Trang nhóm React: https://react.dev/community/team
- Gloaguen và cộng sự, "Evaluating AGENTS.md": https://arxiv.org/abs/2602.11988
- OWASP, CSV Injection: https://community.owasp.org/attacks/CSV_Injection

## Kết luận

Repo này không cần thêm agent. Nó cần khoảng một chục test và hai chỗ sửa thứ tự ghi file. Đó cũng chính là luận điểm của bài viết: câu hỏi nên đặt ra là *làm sao biết code này đúng*, trước khi hỏi *làm sao sinh ra nhiều code hơn*.

Sau khi tra nguồn gốc, bài học sắc hơn một bậc: với mỗi quy tắc đang nằm trong README hay trong đầu người duyệt, hãy hỏi nó có thể được ép bằng code, lint hoặc test hay không, và chỉ để lại ở dạng văn bản những gì thật sự không ép được.
