# ĐẶC TẢ BẢN MỞ RỘNG (các đề xuất C1–C13)

Bổ sung cho `SPEC.md`. `SPEC.md` (R1–R10) vẫn là gốc; chỗ nào tài liệu này không nói thì giữ nguyên.

## 0. Nguyên tắc "bản riêng"

- **Một mã nguồn, hai bản cài.** Mỗi đề xuất là một *tính năng mở rộng* bật/tắt được. Bản **chuẩn** (đúng 91 đầu việc)
  mặc định TẮT hết; bản **mở rộng** mặc định BẬT hết. Quản trị bật/tắt từng tính năng trong màn hình
  Danh mục › Tính năng mở rộng.
- **Tắt = y như bản chuẩn.** Khi một tính năng tắt: giao diện không hiện gì của nó; API của nó trả
  `404 FEATURE_OFF`; mọi hành vi, số liệu, file xuất giống hệt bản chuẩn. **Ba bộ test hiện có (Go, `qa/`, `e2e/`)
  phải đạt nguyên vẹn, không sửa, với mọi tính năng tắt.**
- Lưu: `settings.features JSONB` chỉ chứa các khóa quản trị đã chủ động đặt. Giá trị hiệu lực = giá trị đã lưu nếu có,
  nếu không thì theo bản cài: `KHO_EDITION=extended` ⇒ bật, không đặt ⇒ tắt. Tính năng chưa xây xong: `available=false`,
  không bật được. `GET /api/features` (mọi người dùng đã đăng nhập),
  `PUT /api/features` (quản trị; ghi audit; phát SSE `features` để các máy cập nhật menu ngay).
- Khóa tính năng: `permissions`, `period_lock`, `import_excel`, `min_stock`, `price_list`, `credit_limit`,
  `profit_report`, `stocktake`, `unit_conversion`, `vat`, `print_template`. (C13 HTTPS là cấu hình máy chủ, không phải khóa.)
- Dữ liệu do tính năng tạo ra (ví dụ phiếu kiểm kê đã ghi sổ, thuế trên phiếu) **vẫn có hiệu lực** khi tắt tính năng sau
  đó: tắt chỉ ẩn màn hình và chặn tạo/sửa mới, không đổi số liệu đã ghi sổ. Tắt `permissions` ⇒ quay về 2 vai trò gốc.
- Migration chỉ thêm (cột mới có mặc định, bảng mới); không đổi nghĩa cột cũ.
- Mọi thông báo lỗi tiếng Việt; mọi báo cáo mới xuất được xlsx và có id để mở chi tiết (R10); mọi thay đổi có audit.

## Đợt M1 — kiểm soát và nhập liệu

### C1 `permissions` — phân quyền
- Vai trò: `admin` (toàn quyền), `ketoan` (như hiện nay: mọi nghiệp vụ), thêm `banhang`, `muahang`, `thukho`.
- Quyền (chuỗi): `sale.write` (phiếu bán, khách trả hàng), `purchase.write` (nhập mua, trả NCC), `stock.write` (chuyển kho,
  tồn đầu kỳ, kiểm kê), `cash.write` (phiếu thu/chi), `catalog.write` (hàng hóa, đối tác, nhóm, kho, tài khoản tiền),
  `posted.edit` (sửa / bỏ ghi sổ / xóa chứng từ ĐÃ ghi sổ), `cost.view` (xem giá mua, giá vốn, lãi), `debt.view`
  (công nợ), `cash.view` (sổ quỹ, ngân hàng), `report.view` (báo cáo mua/bán).
  Xem tồn kho, thẻ kho, danh mục: mọi vai trò.
- Mặc định: `ketoan` = tất cả; `banhang` = sale.write, cash.write, debt.view, report.view;
  `muahang` = purchase.write, stock.write, cash.write, cost.view, debt.view, report.view; `thukho` = stock.write.
  Quản trị sửa được ma trận vai trò × quyền (`GET/PUT /api/role-permissions`); `admin` luôn đủ quyền, không sửa được.
- Thực thi **ở máy chủ**: thiếu quyền ⇒ `403 FORBIDDEN` kèm tên quyền bằng tiếng Việt. Giao diện ẩn nút/menu tương ứng.
- Không có `cost.view`: mọi phản hồi và file xuất che `purchase_price`, giá vốn, giá mua gần nhất, đơn giá và thành tiền
  trên chứng từ mua (trả `null`); cảnh báo bán lỗ vẫn hiện nhưng không kèm con số giá mua; không xem được báo cáo mua và
  báo cáo lãi gộp. Che ở máy chủ, không chỉ ở giao diện.
- `/api/auth/me` trả thêm `permissions: []`. Khi tính năng tắt: `admin` và `ketoan` có mọi quyền như bản chuẩn; người dùng
  mang vai trò mới (`banhang`, `muahang`, `thukho`) được coi như `ketoan`. Vì vậy `PUT /api/features` tắt `permissions`
  khi còn người dùng mang vai trò mới phải trả `409` nêu tên những người đó, trừ khi gửi kèm `confirm=true`.

### C4 `period_lock` — khóa sổ
- `settings.lock_date DATE NULL`. Với ngày hạch toán ≤ `lock_date` (kỳ đã khóa):
  - không tạo chứng từ kho hay phiếu thu/chi mới (kể cả phiếu tạm) có ngày trong kỳ khóa;
  - chứng từ ĐÃ ghi sổ và phiếu thu/chi trong kỳ khóa: không sửa, không bỏ ghi sổ, không xóa; không đổi ngày từ ngoài vào
    trong kỳ khóa hoặc ngược lại;
  - phiếu tạm đã có sẵn trong kỳ khóa: sửa, xóa, dời ngày ra ngoài kỳ được, nhưng không ghi sổ được;
  - khi đang có ngày khóa: không đổi công nợ đầu kỳ của đối tác, số dư đầu của tài khoản tiền, không nhập công nợ đầu kỳ
    từ Excel (các số này không có ngày nên luôn ảnh hưởng kỳ đã khóa) — phải bỏ khóa trước.
  Vi phạm ⇒ `422 PERIOD_LOCKED` ("Kỳ đến dd/mm/yyyy đã khóa sổ…").
- Chỉ quản trị đặt / lùi / bỏ ngày khóa (`PUT /api/period-lock {lock_date, reason}`), có audit. Không cho đặt ngày khóa
  trong tương lai.

### C3 `import_excel` — nhập từ Excel
- 4 loại: `products` (mã, tên, ĐVT, nhóm, giá bán, giá mua), `partners` (mã, tên, là KH, là NCC, địa chỉ, ĐT, MST),
  `opening_stock` (mã hàng, mã kho, số lượng, đơn giá), `opening_debt` (mã đối tác, phải thu, phải trả).
- `GET /api/import/{loai}/template` ⇒ file xlsx mẫu có dòng tiêu đề tiếng Việt, 2 dòng ví dụ, sheet "Hướng dẫn".
- `POST /api/import/{loai}?dry_run=1` (multipart, ≤ 10 MB, ≤ 20.000 dòng) ⇒ không ghi gì, trả
  `{rows, creates, updates, errors:[{row, column, message}]}`. Nhận số kiểu Việt ("1.500.000", "2,5"), bỏ dòng trống,
  cắt khoảng trắng, nhận diện cột theo tiêu đề (không theo vị trí), báo trùng mã trong file.
- `POST …` không `dry_run`: **tất cả hoặc không gì** (một giao dịch); còn lỗi ⇒ `422` kèm danh sách lỗi, không ghi.
  Danh mục: thêm mới hoặc cập nhật theo mã (không xóa). `opening_stock`: tạo một phiếu Tồn đầu kỳ TẠM cho mỗi kho, ngày
  do người dùng chọn (tham số `date`), người dùng xem lại rồi ghi sổ; mã hàng/kho chưa có ⇒ lỗi. `opening_debt`: đặt công
  nợ đầu kỳ theo đúng cơ chế hiện có; chạy lại thì thay thế số cũ của các đối tác có trong file.
- Cần quyền `catalog.write` (danh mục) / `stock.write` (tồn) / quản trị (công nợ đầu kỳ).

## Đợt M2 — bán hàng và công nợ

### C5 `min_stock` — tồn tối thiểu từng mã
`products.min_stock NUMERIC NULL` (tính trên tổng 4 kho). Bật: "hàng sắp hết" = tồn ≤ min_stock của mã (mã không đặt ⇒
không cảnh báo); báo cáo Hàng cần đặt thêm cột Tồn tối thiểu, Cần đặt thêm = max(0, min − (tồn − số lượng trên phiếu tạm)), tức đặt đủ để sau khi giao hết phiếu tạm vẫn còn mức tối thiểu.
Tắt: ngưỡng chung ≤ 5 như cũ.

### C6 `price_list` — giá theo khách
- `partner_prices(partner_id, product_id, price, note, updated_by, updated_at)`; màn hình trong hồ sơ khách + nhập nhanh
  từ phiếu ("Lưu giá này cho khách").
- Giá tự điền khi gõ mã trên phiếu bán: (1) giá riêng của khách; (2) giá bán gần nhất của mã này cho khách này trên phiếu
  đã ghi sổ; (3) giá bán mặc định. Giao diện ghi rõ nguồn giá. Người dùng vẫn sửa được. Cảnh báo bán lỗ không đổi.

### C8 `credit_limit` — hạn mức và tuổi nợ
- `partners.credit_limit NUMERIC NULL`, `partners.payment_days INT NULL`.
- Ghi sổ phiếu bán mà (nợ phải thu hiện tại + phiếu này) > hạn mức ⇒ `409 CREDIT_WARNING` (số nợ, hạn mức, vượt bao
  nhiêu); gửi lại với `confirm_credit=true` thì ghi sổ; ghi vào audit ai đã xác nhận. Không chặn cứng.
- Báo cáo Tuổi nợ phải thu đến ngày D: mỗi khách các cột Trong hạn / 1–30 / 31–60 / 61–90 / >90 ngày quá hạn. Cách tính:
  các khoản giảm nợ trừ vào khoản tăng nợ cũ nhất trước (FIFO); hạn = ngày phát sinh + payment_days (không đặt ⇒ 0).
  Thêm cột Đầu kỳ (nợ đầu kỳ không có ngày, là khoản cũ nhất) và cột Trả trước (khách trả dư, số âm).
  Tổng các cột = số nợ trong sổ công nợ cùng ngày (bắt buộc khớp, có test).

### C7 `profit_report` — lãi gộp
- Giá vốn một dòng bán = **giá nhập bình quân gia quyền** của mã đó tính trên toàn bộ lượng nhập mua và tồn đầu kỳ đã ghi
  sổ đến hết ngày bán (4 kho gộp chung); chưa có lượng nhập nào ⇒ dùng giá mua mặc định, đánh dấu "ước tính".
  Khách trả hàng: giảm doanh thu và giảm giá vốn theo cùng cách. Dịch vụ: giá vốn 0. (Quy tắc cần khách xác nhận.)
- Báo cáo theo phiếu / theo mặt hàng / theo khách: doanh thu, giá vốn, lãi gộp, tỷ lệ; ba cách nhóm phải cùng tổng.
  Cần `cost.view`.

## Đợt M3 — kho, chứng từ, in ấn

### C9 `stocktake` — kiểm kê
Loại chứng từ `stocktake`, số `KK00001`, một kho, một ngày. Dòng: mã hàng, tồn sổ sách (máy tính tại thời điểm cuối ngày
kiểm, tính lại khi ghi sổ), tồn thực tế (nhập), chênh lệch. Nút "Nạp toàn bộ mã đang có tồn". Ghi sổ ⇒ sinh dòng sổ kho
nhập (thừa) / xuất (thiếu) đúng bằng chênh lệch; R6 (không âm về sau) vẫn áp dụng; không ảnh hưởng công nợ. Thẻ kho ghi
"Kiểm kê thừa/thiếu". In biên bản, xuất xlsx/docx.

### C10 `unit_conversion` — quy đổi đơn vị
`product_units(product_id, unit, factor)`; đơn vị gốc là `products.unit` (factor 1). Dòng chứng từ thêm `unit`, `factor`;
số lượng và đơn giá người dùng nhập theo đơn vị đã chọn; sổ kho luôn ghi theo đơn vị gốc (qty × factor). Tồn kho, thẻ
kho, kiểm tra tồn tính theo đơn vị gốc; phiếu in theo đơn vị đã chọn. Cảnh báo bán lỗ so trên giá quy về đơn vị gốc.
Không cho xóa/sửa hệ số của đơn vị đã dùng trên chứng từ.

### C11 `vat` — thuế GTGT trên phiếu
Dòng chứng từ mua/bán thêm `vat_rate` (KCT, 0, 5, 8, 10; mặc định theo `products.vat_rate`, mặc định chung trong cài
đặt). Tiền thuế dòng = round(thành tiền × thuế suất). Phiếu hiện Cộng tiền hàng / Tiền thuế / Tổng thanh toán; công nợ
tính theo Tổng thanh toán. Báo cáo mua/bán thêm cột trước thuế, thuế, sau thuế; bảng kê thuế theo thuế suất. Không nối hóa
đơn điện tử. Phiếu cũ (không thuế) giữ nguyên.

### C12 `print_template` — mẫu in
Cài đặt: logo (png/jpg ≤ 500 KB), khổ giấy mặc định cho phiếu hàng (A4/A5) và phiếu thu chi, dòng chân trang, ẩn/hiện
cột ĐVT và cột Mã hàng, tên các ô ký. Áp cho bản in; file xuất dùng cùng tên ô ký và chân trang.

### C13 HTTPS
`TLS_CERT`, `TLS_KEY` (đường dẫn file) ⇒ máy chủ chạy HTTPS và tự bật cookie Secure; hướng dẫn tạo chứng thư tự ký trong
`CAI_DAT.md`. Không làm truy cập từ Internet.

## Kiểm thử
Mỗi đợt: test Go mới tên `TestMR_Cx_…`; QA hộp đen và E2E độc lập bổ sung thư mục riêng (`qa/mr_*.py`,
`e2e/tests-mo-rong/`) chạy với `KHO_EDITION=extended`; ba bộ cũ chạy lại với tính năng tắt và phải đạt nguyên vẹn.
