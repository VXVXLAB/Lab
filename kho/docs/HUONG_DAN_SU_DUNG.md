# Hướng dẫn sử dụng

Phần mềm chạy trên trình duyệt. Mọi máy trong công ty mở cùng một địa chỉ (ví dụ `http://192.168.1.10:8080`) và thấy cùng một dữ liệu. Đăng nhập bằng tên và mật khẩu người quản trị cấp cho bạn.

Gõ phím là nhanh nhất: **Enter** để sang ô kế tiếp, **Ctrl+S** để lưu, **Esc** để đóng. Mỗi màn hình có ghi phím tắt ở dưới cùng.

## Bắt đầu dùng lần đầu

1. **Thông tin công ty** (Hệ thống › Thông tin công ty): tên, địa chỉ, điện thoại, mã số thuế. Những thông tin này in ở đầu mọi phiếu.
2. **Danh mục**: nhập hàng hóa (mã, tên, ĐVT, giá bán, giá mua), nhóm hàng, khách hàng, nhà cung cấp, kho, tài khoản tiền.
3. **Tồn đầu kỳ** (Kho › Tồn đầu kỳ): mỗi kho một phiếu, ghi số lượng đang có, rồi bấm **Ghi sổ**.
4. **Công nợ đầu kỳ**: khi thêm hoặc sửa khách hàng / nhà cung cấp, ghi "Nợ phải thu đầu kỳ" hoặc "Nợ phải trả đầu kỳ".
5. Bắt đầu lập phiếu bán, phiếu nhập như bình thường.

## Lập phiếu bán hàng

1. Vào Bán hàng › Phiếu bán, bấm **F2**.
2. Gõ vài chữ tên hoặc số điện thoại khách (gõ không dấu cũng được, nhiều chữ theo thứ tự nào cũng được), rồi **Enter**. Nếu danh sách chưa kịp hiện theo đúng chữ vừa gõ, phần mềm chờ kết quả rồi mới chọn — không bao giờ lấy nhầm khách của lần tìm trước. Khách mới: bấm **F4** để thêm ngay mà không phải thoát khỏi phiếu.
3. Kiểm tra kho xuất, rồi **Enter** xuống dòng hàng.
4. Ở ô **Mã hàng**, gõ mã hoặc một phần tên ("que 3.2") rồi **Enter** → gõ số lượng → **Enter** → đơn giá (tự điền theo giá bán, sửa được) → **Enter** sang dòng sau.
5. **Ctrl+S** để lưu tạm, **F9** để ghi sổ. Ghi sổ xong phiếu mới có số chính thức (XK…), mới trừ kho và tính vào công nợ.

Dưới phiếu luôn hiện **Cộng**, **Nợ cũ** và **Tổng nợ**. Cạnh tên khách có công nợ hiện tại của khách, xem trước khi bán.

## Phiếu tạm và làm trên hai máy

- Phiếu chưa ghi sổ là **Phiếu tạm** (số TAM…). Phiếu tạm không trừ kho, không vào công nợ, không giữ hàng.
- Mọi máy đều thấy phiếu tạm ở Bán hàng › **Phiếu tạm đang treo**: ai sửa lần cuối, lúc nào. Máy 2 mở phiếu của máy 1 và làm tiếp bình thường.
- Đang mở một phiếu mà máy khác lưu phiếu đó: nếu bạn chưa sửa gì, phiếu tự hiện bản mới. Nếu bạn đang sửa dở, phần mềm báo **"Phiếu vừa được … sửa"** và không xóa chữ bạn đang gõ.
- Hai máy cùng lưu một phiếu: máy lưu sau được báo **"Máy khác vừa sửa phiếu này"**. Bấm **Tải bản mới** để thấy bản của máy kia. Khung vàng chỉ liệt kê những gì **máy bạn** đã thay đổi so với lúc mở phiếu: dòng **thêm mới**, dòng **đã sửa** (ví dụ "SL 2 → 3") và dòng **đã xóa**. Bấm **Thêm các dòng này vào phiếu** để đưa các thay đổi đó vào bản mới, rồi kiểm tra và **Ctrl+S**. Phần mềm gộp theo **từng ô của từng dòng** (không theo mã hàng — hai dòng cùng mã vẫn là hai dòng riêng):
  - Ô chỉ bạn sửa ⇒ lấy số của bạn. Ô chỉ máy kia sửa ⇒ giữ số của máy kia. Ví dụ máy kia đổi đơn giá, bạn đổi số lượng của cùng dòng ⇒ dòng đó có số lượng của bạn và đơn giá của máy kia.
  - Hai máy sửa **cùng một ô** thành hai số khác nhau ⇒ khung vàng ghi **"Cùng sửa: SL — máy kia: 3, bạn: 4"** và cho chọn **Giữ của máy kia** (sẵn) hoặc **Dùng của tôi**. Phần mềm không tự chọn số của bạn.
  - Bạn sửa một dòng mà máy kia đã xóa dòng đó, hoặc bạn xóa một dòng mà máy kia đã sửa ⇒ khung vàng ghi rõ và cũng cho chọn; để sẵn là giữ như bản máy kia đã lưu.
  - Đang sửa phiếu đã ghi sổ (F8) thì sau **Tải bản mới** phiếu vẫn ở chế độ sửa, bấm ngay **Thêm các dòng này vào phiếu** rồi **Ctrl+S**.
  - Thứ tự dòng (Alt+↑↓): chỉ một máy dời dòng thì giữ thứ tự của máy đó; hai máy cùng dời mỗi máy một kiểu thì khung vàng hỏi, để sẵn là thứ tự của máy kia.
  - Sửa một dòng không bao giờ sinh thêm dòng mới: tổng tiền không bị cộng hai lần. Phiếu thu, phiếu chi cũng gộp đúng như vậy cho từng dòng tiền.
- Đang gõ phiếu mà phiên đăng nhập bị ngắt (ví dụ quản trị đặt lại mật khẩu): phần mềm về màn đăng nhập. Đăng nhập lại **đúng tên của bạn** trên cùng cửa sổ thì phiếu đang gõ dở được khôi phục, có thông báo "Phiên đăng nhập đã hết. Đã khôi phục các dòng đang gõ dở". Lỡ tải lại trang (F5) hay mở lại thẻ khi đang gõ thì phiếu cũng được giữ, thông báo là "Đã khôi phục các dòng đang gõ dở từ lần mở trước"; không cần thì bấm **Bỏ thay đổi**. Bấm **Đăng xuất** chủ động thì phiếu chưa lưu bị bỏ.

## Hàng hết tồn

- Khi gõ phiếu, dòng thiếu hàng hiện chữ đỏ, ví dụ "Thiếu 4 — tồn 6". Vẫn lưu tạm được để gửi khách xem.
- Bấm **Ghi sổ** khi thiếu hàng: phần mềm từ chối và nêu rõ mã nào thiếu bao nhiêu. Phiếu vẫn là phiếu tạm.
- Phiếu tạm in ra có tiêu đề **"PHIẾU TẠM (chưa ghi sổ)"**. Phiếu chính thức chỉ in được sau khi ghi sổ.
- Mua hàng › **Hàng cần đặt** tổng hợp các mã khách đã đặt trên phiếu tạm mà kho không đủ. Bấm **Lập phiếu nhập** để có ngay phiếu nhập đã điền sẵn số lượng thiếu; chỉ cần chọn nhà cung cấp.

## Cảnh báo bán lỗ

Giá bán thấp hơn giá mua gần nhất thì dòng chuyển đỏ: "Bán lỗ: giá mua …". Phần mềm không chặn. Khi ghi sổ sẽ hỏi lại; bấm **Vẫn ghi sổ** nếu đúng là bán giá đó.

## Mã DV (dịch vụ, ghi chú, cộng/trừ tiền)

- Ở ô mã hàng gõ **DV** hoặc **DICHVU**, rồi gõ diễn giải tự do (ví dụ "PHÍ SỬA XE", "TRẢ 01 ĐỒNG HỒ").
- Đơn giá **dương** thì cộng vào phiếu, **âm** thì trừ ra (chiết khấu), **để trống** là dòng ghi chú. Dòng DV không tính tồn kho.

## Sửa phiếu cũ

- Tìm phiếu: ở danh sách gõ số phiếu, tên khách hoặc chọn "Có mặt hàng…". Chọn thời gian "Tất cả" để tìm cả phiếu từ đầu năm.
- Phiếu đã ghi sổ: bấm **Sửa phiếu (F8)**, sửa xong **Ctrl+S**. Tồn kho, công nợ và báo cáo tự tính lại.
- Nếu việc sửa làm âm kho ở một ngày sau, phần mềm báo ngay khi bạn gõ và không cho lưu.
- **Bỏ ghi sổ** đưa phiếu về phiếu tạm, giữ nguyên số. **Xóa** chỉ áp dụng cho phiếu tạm.
- Nút đồng hồ (Lịch sử) cho biết ai sửa gì, lúc nào.

## Chuyển kho

Vào Kho › Chuyển kho, bấm **F2**. Chọn kho xuất, kho nhận, gõ mã và số lượng, rồi **F9** để ghi sổ. Kho xuất giảm, kho nhận tăng, tổng tồn không đổi.

## Xem tồn kho và thẻ kho

- Kho › **Tồn kho**: mỗi mã có tồn 4 kho và tổng. Lọc được theo nhóm hàng và tồn đến một ngày bất kỳ. **Xuất Excel** xuất toàn bộ các mã.
- Bấm vào số tồn để mở **thẻ kho** ngay tại chỗ: từng lần nhập, xuất, mua của ai, bán cho ai, tồn sau mỗi lần. Bấm tiếp vào một dòng để xem phiếu. **Esc** đóng từng lớp.
- Đang gõ phiếu: đứng ở dòng hàng, bấm **F6** để xem thẻ kho, **F7** để xem lịch sử bán (bán cho ai, giá bao nhiêu lần trước).

## Công nợ

- Công nợ › **Phải thu** (khách nợ mình) / **Phải trả** (mình nợ nhà cung cấp): đầu kỳ, tăng, giảm, cuối kỳ của từng đối tác.
- Bấm vào một đối tác để mở **sổ chi tiết công nợ**: từng phiếu bán, phiếu trả hàng, phiếu thu, phiếu chi kèm số dư. Bấm một dòng để xem phiếu đó.
- Trong sổ chi tiết có nút **Thu tiền** / **Chi tiền** để lập phiếu cho đúng đối tác.

## Thu chi nhiều dòng

1. Quỹ & Ngân hàng › **Thu tiền** (hoặc **Chi tiền**), bấm **F2**.
2. Chọn **Tiền mặt** hay **Ngân hàng**. Lựa chọn này quyết định số phiếu: PT/PC cho tiền mặt, BC/BN cho ngân hàng.
3. Chọn khách hàng / nhà cung cấp. Bỏ trống nếu là thu/chi khác (không vào công nợ).
4. Mỗi khoản tiền một dòng: diễn giải → **Enter** → số tiền → **Enter** sang dòng sau. Có thể chọn "Chứng từ liên quan" để ghi rõ khoản tiền trả cho phiếu nào.
5. **Ctrl+S**. Phiếu thu/chi có hiệu lực ngay khi lưu. Công nợ "trước phiếu → sau phiếu" hiện ngay trên màn hình.

Từ một phiếu bán đã ghi sổ, bấm **Thu tiền phiếu này** để có ngay phiếu thu đã điền sẵn.

Trường hợp đặc biệt: **thu tiền của nhà cung cấp** (họ hoàn tiền) hoặc **chi tiền cho khách** (trả lại tiền khách). Phần mềm sẽ hỏi rõ phiếu này là gì để ghi đúng công nợ.

**Sổ quỹ / Sổ ngân hàng** (Quỹ & Ngân hàng › Sổ quỹ): tồn đầu, từng khoản thu chi, tồn cuối.

## Xuất Excel, Word và in

- Trong phiếu: nút **In** (Ctrl+P) để xem trước rồi in (A4/A5). Mũi tên cạnh nút In có **Xuất Excel** và **Xuất Word**. File xuất sửa được, thêm bớt dòng cột được.
- Mọi báo cáo có nút **Xuất Excel** (đúng bộ lọc đang xem) và **In**.
- Phiếu thu/chi in khổ A5, có dòng "Bằng chữ" (ví dụ 1.234.000 = "Một triệu hai trăm ba mươi bốn nghìn đồng").

## Phím tắt

| Phím | Việc |
|---|---|
| F2 | Lập phiếu mới / thêm mới |
| F3 hoặc / | Tìm kiếm |
| Enter | Sang ô kế tiếp; trong danh sách: mở |
| Ctrl+S | Lưu |
| F9 | Ghi sổ |
| F8 | Sửa phiếu đã ghi sổ |
| Ctrl+P | In |
| F4 | Thêm khách hàng / nhà cung cấp ngay trong phiếu |
| F6 / F7 | Thẻ kho / lịch sử bán của dòng đang đứng |
| Ctrl+Delete / Ctrl+Insert | Xóa dòng / chèn dòng |
| Alt+↑ / Alt+↓ | Dời dòng lên / xuống |
| Esc | Đóng hộp thoại, khung chi tiết |

## Đổi mật khẩu

Bấm vào tên của bạn ở góc trên bên phải, chọn **Đổi mật khẩu**. Quên mật khẩu thì nhờ người quản trị đặt lại.
