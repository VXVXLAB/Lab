# BÁO CÁO QA ĐỘC LẬP (kiểm thử hộp đen backend `khoserver`)

Bộ test viết hoàn toàn từ tài liệu của khách (`YEU_CAU_PHAN_MEM.txt`, `TODO_91_DAU_VIEC.md`), `SPEC.md` và `API.md`;
không đọc mã nguồn hay test của backend. Mọi số kỳ vọng tự tính tay (hoặc bằng mô hình độc lập trong `t_recon.py`).
`NGHIEM_THU.md` / `QUYET_DINH.md` chỉ được đọc **sau** lần chạy đầu tiên, để phân loại phát hiện.

## 1. Cách chạy và kết quả

```
cd /home/user/Lab/kho/qa && ./run.sh            # chạy tất cả
./run.sh test_RECON                              # lọc theo tên test
```
`run.sh` tạo CSDL mới `kho_qa`, chạy `backend/bin/khoserver` ở cổng 18181, chạy test (Python 3: chỉ `requests`,
`openpyxl`, `python-docx`), dừng server và xóa CSDL. Kết quả: `qa/out/run.log`, `qa/out/results.json` (có danh sách mọi phản hồi 5xx).
Mỗi test gắn mã REQ; mọi phản hồi 5xx tự động làm test hiện tại FAIL.

Kết quả lần chạy thật (14/11/2026):
```
TESTS: 45  PASS: 38  FAIL: 7   checks: 16770  failed checks: 23   time: 15s
HTTP 5xx responses seen: 3
REQ covered: 001…087 (đủ 009–087)
recon stats: {'ops': 202, 'accepted': 171, 'refused': 31, 'mismatch': 0}, docs=150, vouchers=16
```

Điểm mạnh xác nhận được (đều ĐẠT): hai ví dụ của khách tái hiện chính xác (thẻ kho WW829HT107k: đầu kỳ 27 → 23 → 20 → 21 → 20,
nhập 1 / xuất 8; phiếu bán có DICHVU: Cộng 3.990.000, Nợ cũ 2.000.000, Tổng nợ 5.990.000 — cả khi nợ cũ là số dư đầu kỳ lẫn khi là
phiếu bán ngày 10/08/2026); chuỗi 260 thao tác giả ngẫu nhiên xác định (mua/bán/trả/chuyển kho/sửa phiếu cũ: SL, giá, ngày, đối tác,
kho, thêm/bớt dòng/bỏ ghi sổ/ghi sổ lại/xóa phiếu tạm/thu chi sửa xóa) — server quyết định chấp nhận/từ chối **trùng 100%** với mô hình
độc lập (171 chấp nhận, 31 từ chối 422), và tồn 4 kho = tổng, stock-summary = thẻ kho = NXT, công nợ (tổng hợp, sổ chi tiết, theo kỳ),
sổ quỹ đều khớp mô hình; chuyển kho không đổi tổng; phiếu tạm không đổi gì. Tranh chấp đồng thời (2 máy ghi sổ cùng tồn, 10 phiếu tranh
1000 tồn, sửa/bỏ ghi sổ phiếu nhập song song với ghi sổ phiếu bán, 2 phiếu chuyển kho song song, sửa cùng version) đều đúng. Mọi id
drill-down trong mọi báo cáo (≈7.200 kiểm tra trên toàn CSDL) mở đúng chứng từ/phiếu. Mọi file xlsx/docx mở được, không khóa, không
ảnh, tiếng Việt nguyên vẹn, số lượng/tiền trong bảng là ô số.

## 2. Phát hiện (nặng trước)

### Lỗi xác nhận (backend bug)

**B1. Ký tự NUL (`\u0000`) trong dữ liệu nhập ⇒ 500 INTERNAL** (REQ-023/025, độ bền) — trái `API.md` "500 không bao giờ do người dùng nhập sai".
```
POST /api/products {"code":"P0365","name":"Tên có ký tự NUL\u0000","unit":"Cái"}            -> 500 INTERNAL
POST /api/documents {... "note":"ghi chú\u0000", "lines":[{"product_id":275,"qty":1,"unit_price":1}]} -> 500 INTERNAL
GET  /api/products?q=a%00b                                                                    -> 500 INTERNAL
```
Kỳ vọng: 400 VALIDATION (PostgreSQL không lưu được NUL trong text). Thực tế xảy ra khi dán văn bản từ Excel/Word/PDF lỗi.
Test: `test_ROBUST_input_edge_values`.

**B2. Đối tác đã có chứng từ bị đổi cờ KH/NCC ⇒ phiếu cũ không sửa được nữa** (REQ-003/036/038/081).
```
(KH c có phiếu bán XK đã ghi sổ)  PUT /api/partners/{c} {..., "is_customer":false, "is_supplier":true} -> 200 (cho phép)
PUT /api/documents/{sale} {... "note":"sửa sau khi đổi loại đối tác", "version":2, "confirm_loss":true}
-> 400 {"code":"VALIDATION","message":"Đối tác Đối tác DT0286 không phải là khách hàng","details":{"field":"partner_id"}}
```
Kỳ vọng: hoặc chặn đổi cờ khi đã phát sinh (như với `is_service` – đã chặn đúng), hoặc phiếu cũ vẫn sửa được (QUYET_DINH B7,
SPEC R3 "sửa được bất kỳ lúc nào"). Hiện tại khách sửa nhầm danh mục là khóa luôn khả năng sửa chứng từ quá khứ của đối tác đó.
Test: `test_REQ038_edit_posted_doc_misc_rules`.

**B3. Ngày `0001-01-01` bị coi là "trống" ⇒ âm thầm thay bằng hôm nay / bỏ lọc** (REQ-019; trái QUYET_DINH B5 "năm 2000–2100").
```
POST /api/documents {"doc_type":"sale","doc_date":"1999-12-31",...}  -> 400 "Ngày chứng từ không hợp lệ"   (đúng)
POST /api/documents {"doc_type":"sale","doc_date":"0001-01-01",...}  -> 201, doc_date = "2026-11-14"        (sai)
POST /api/vouchers  {"voucher_date":"0001-01-01",...}                -> 201, voucher_date = "2026-11-14"    (sai)
GET  /api/reports/stock-ledger?product_id=P&from=0001-01-01          -> rows: [], closing 0 (đúng phải 1 dòng, tồn 7)
GET  /api/reports/stock-summary?as_of=0001-01-01                     -> as_of "2026-11-14", tồn 7 (đúng phải 0 hoặc 400)
```
Mức độ thấp (giá trị cực đoan), nhưng là thay đổi dữ liệu âm thầm và báo cáo trả rỗng sai. Test: `test_ROBUST_input_edge_values`,
`test_ROBUST_extreme_but_valid_dates_in_reports`.

**B4. Dòng tiền 0,001 được nhận rồi lưu thành 0** (REQ-056..061; trái API.md §4 "amount > 0 mỗi dòng").
```
POST /api/vouchers {"voucher_type":"receipt","account_id":..,"partner_id":..,"lines":[{"description":"x","amount":0.001}]}
-> 201, total_amount 0, lines[0].amount 0
```
Kiểm tra `> 0` chạy trước khi làm tròn 2 chữ số. (Tương tự `unit_price:"1e-400"` → 0; hàng hóa giá 0 là hợp lệ nên chỉ ghi nhận.)

**B5. File Excel phiếu: ô "Cộng" là công thức có kết quả lưu dạng chuỗi; "Nợ cũ"/"Tổng nợ" là văn bản** (REQ-071/072/074/087).
Phiếu mẫu của khách xuất ra: ô Cộng = `SUM(G7:G13)` với `t="str"`, giá trị lưu `"3990000"` (chuỗi, không phải số);
"Nợ cũ: 2.000.000" và "Tổng nợ (đến ngày 25/09/2026): 5.990.000" mỗi cái là một ô văn bản (nhãn + số chung một ô).
Hậu quả: trình xem không tính lại công thức (LibreOffice mặc định "không tính lại" với xlsx, xem trước trên điện thoại/Zalo) hiển thị
tổng là chữ; kế toán thêm dòng dịch vụ sau khi xuất (đúng nhu cầu "thêm bớt dòng") thì Tổng nợ không tự đổi và không thể tham chiếu
bằng công thức. Đề nghị: ghi kết quả công thức dạng số; Nợ cũ/Tổng nợ để nhãn và số ở 2 ô, Tổng nợ = công thức (Nợ cũ + Cộng).
(Docx hiển thị đúng 3.990.000 / 2.000.000 / 5.990.000.) Test: `test_REQ047_083_customer_sale_slip_example`.
Phụ: đơn giá có số lẻ (13.001,5) được định dạng `#,##0` nên Excel hiện "13.002" dù giá trị đúng.

### Quy tắc nghiệp vụ cần khách xác nhận (không phải lỗi code, nhưng ảnh hưởng số liệu)

**Q1. Thu tiền NCC hoàn lại / chi trả lại tiền khách làm sai cả hai sổ công nợ** (REQ-007/062/084; yêu cầu gốc mục 6 "thu – chi …
cho cùng 1 ncc hay khách hàng"). QUYET_DINH F3 đã ghi "cần khách xác nhận"; QA khuyến nghị sửa vì kịch bản rất thường gặp:
```
NCC chỉ-NCC: mua 1.000.000 → chi 1.000.000 → trả hàng NCC 500.000  ⇒ phải trả = −500.000 (NCC nợ lại mình)
POST /api/vouchers {"voucher_type":"receipt", "partner_id":NCC, "lines":[{"description":"NCC hoàn tiền","amount":500000}]} -> 201
Thực tế: phải trả vẫn −500.000; phải THU của NCC (vốn không phải KH) = −500.000.  Kỳ vọng: phải trả 0, phải thu 0.
Khách hàng: bán 600.000 → thu 600.000 → khách trả hàng 200.000 ⇒ phải thu −200.000; chi trả lại khách 200.000
Thực tế: phải thu vẫn −200.000, phải TRẢ của khách = −200.000.  Kỳ vọng: 0 / 0.
```
Hai số âm treo vĩnh viễn ở hai báo cáo, tổng phải thu/phải trả trên dashboard sai theo. Test: `test_REQ062_refunds_supplier_receipt_and_customer_payment`.

**Q2. Xóa phiếu tạm (đã từng ghi sổ) mà phiếu thu đang liên kết ⇒ âm thầm gỡ liên kết** (REQ-062). Phiếu thu
"Thu tiền XK00135" còn nguyên số tiền nhưng `document_id` thành `null` (QUYET_DINH A4 cố ý `ON DELETE SET NULL`). Đề nghị cảnh báo
hoặc chặn (409 IN_USE) để kế toán biết phiếu thu đang treo. Test: `test_REQ038_edit_posted_doc_misc_rules`.

**Q3. Tìm kiếm không dấu chưa nhất quán.** Mặt hàng/đối tác/tên KH trên chứng từ, báo cáo bán, công nợ: tìm không dấu ĐẠT. Nhưng:
`GET /api/documents?q=thu duc` không ra phiếu có ghi chú "Giao hàng Thủ Đức" (gõ có dấu thì ra); `GET /api/warehouses?q=binh duong`
không ra "Kho Bình Dương". API.md chỉ hứa không dấu cho mặt hàng/đối tác nên là **hạn chế/thiếu sót tài liệu**, mức thấp.
Tests: `test_ROBUST_vietnamese_search_without_diacritics`, `test_ROBUST_catalog_rules`.

**Q4. Ghi chú nhỏ khác (không làm test fail):** phiếu chi có thể làm số dư ngân hàng âm (không kiểm soát quỹ âm); phiếu khách trả
hàng không cần khách từng mua mặt hàng đó; kho ngừng dùng vẫn ngừng được khi còn tồn (tồn vẫn hiện trong báo cáo — đúng).

### Sai lệch tài liệu API.md
- §4 "amount > 0 mỗi dòng" — thực tế nhận 0,001 rồi lưu 0 (B4).
- §0 "500 … không bao giờ do người dùng nhập sai" — NUL ⇒ 500 (B1).
- §2 "phiếu cũ đang dùng vẫn sửa được" khi danh mục đổi trạng thái — sai với đổi cờ KH/NCC (B2).
- Còn lại: mọi hình dạng JSON, mã lỗi (400/401/403/404/409/422), chi tiết `Shortage`/`LOSS_WARNING`/`VERSION_CONFLICT`, tiêu đề và
  tên file xuất, SSE (`document.changed`/`voucher.changed`/`catalog.changed`, trường `by`) đều khớp tài liệu.

## 3. Mã REQ không kiểm thử được từ bên ngoài (hoặc chỉ một phần)
- **088–091** (UAT, sửa lỗi sau UAT, hướng dẫn sử dụng, bàn giao): cần khách / không phải hành vi API.
- **068–070, 086** "bấm vào mở ngay trong màn báo cáo (Drawer/Modal)": chỉ kiểm được phần backend (mọi id trả về mở đúng bản ghi);
  phần không rời trang là giao diện.
- **032** "in phiếu": kiểm qua file xuất (tiêu đề PHIẾU TẠM / phiếu chính thức); việc in giấy thực tế là giao diện.
- **074/087** "chỉnh sửa được": mô phỏng bằng openpyxl/python-docx (chèn dòng/cột, lưu lại; không khóa sheet/tài liệu); chưa mở bằng
  Excel/Word thật.
- **042–044** "nhiều máy": mô phỏng bằng 2 người dùng/2 phiên đồng thời trên cùng server + SSE; không thử qua mạng LAN thật.
- **001–008** là quy tắc đã chốt, được kiểm gián tiếp qua các REQ chi tiết.
