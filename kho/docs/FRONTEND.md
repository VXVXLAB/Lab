# FRONTEND — giao diện web

React 18 + TypeScript (strict) + Vite 5 + Ant Design 5 (`vi_VN`) + TanStack Query 5 + react-router 6 + dayjs (vi).
Không thêm thư viện khác nếu chưa thật cần (hiện chỉ 7 gói chạy + 5 gói build).

## Chạy

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 — proxy /api (kể cả SSE) sang http://localhost:8080
npm run typecheck    # tsc --noEmit
npm run build        # tsc + vite build ⇒ frontend/dist (máy chủ Go phục vụ tại http://localhost:8080/)
```

Máy chủ Go đọc `STATIC_DIR` (mặc định `../frontend/dist` tính từ `backend/`), có SPA fallback ⇒ build xong chỉ cần
tải lại trang ở `:8080`, không phải khởi động lại máy chủ. Dữ liệu mẫu: `cd backend && go run ./cmd/seeddemo -reset`.

## Cấu trúc `src/`

```
main.tsx                 điểm vào (nạp dayjs vi trước)
App.tsx                  ConfigProvider(vi_VN, theme) → AntApp → QueryClient → Auth → data router (createBrowserRouter,
                         cần cho useBlocker) → Root (đăng nhập?) → Events → AppLayout → màn hình
theme.ts                 token màu/cỡ chữ/bảng (một chỗ)
styles.css               CSS toàn cục (khung, bảng, ô thống kê, trang danh sách); không CSS-in-JS riêng
paths.ts                 MỌI đường dẫn màn hình (paths.sales, paths.document(id)…) — không viết chuỗi URL ở nơi khác
routes.tsx               menu trái + route + tiêu đề trang, một bảng duy nhất (`menu`, `hiddenScreens`)
api/
  client.ts              fetch duy nhất: ApiError {status, code, message, details, field, lineNo}, 401 ⇒ về đăng nhập,
                         lỗi mạng ⇒ câu tiếng Việt; `api.get/post/put/del`
  types.ts               kiểu dữ liệu đúng docs/API.md (danh mục, chứng từ, cảnh báo, thiếu hàng, dashboard, sự kiện SSE)
  catalog.ts             hàm gọi danh mục, người dùng, dashboard, báo cáo tồn (dựng trên `api`)
  documents.ts           chứng từ kho: list (+sum_total_amount)/get/create/update/post/unpost/remove/check/checkDraft/history/exportUrl
  reports.ts             reportApi (stock-summary, stock-nxt, stock-ledger, sales, purchases, draft-demand, xlsxUrl), settingsApi, authApi
  hooks.ts               useWarehouses, useAllGroups, useSettings (truy vấn dùng chung)
  queryKeys.ts           khóa cache — xem "Cache & cập nhật trực tiếp"
auth/                    AuthContext (useAuth, useCurrentUser), LoginPage
layout/AppLayout.tsx     khung: menu trái (thu gọn được, tự thu gọn < 992px), thanh trên (đường dẫn, trạng thái kết nối,
                         người dùng, Đăng xuất)
lib/
  format.ts              formatMoney, formatQty, parseVnNumber, formatDate, formatDateTime, toApiDate, fromApiDate, todayVn…
  events.tsx             EventsProvider (một kết nối SSE), useLiveStatus, useServerEvent
  keyboard.ts            useHotkeys, enterToNext, focusFirstField, isOverlayOpen
  labels.ts              nhãn tiếng Việt cho doc_type, role, loại tài khoản tiền
  storage.ts             localStorage bọc try/catch (chỉ tiện ích từng máy)
  useDebounced.ts        useDebounced, useElementHeight
  menuHighlight.ts       useMenuHighlight(path, title): màn mở từ chỗ khác (phiếu) báo mục menu cần tô sáng + tiêu đề
components/
  NumberInput.tsx        ô số kiểu Việt Nam (dùng cho MỌI ô tiền/số lượng); hiển thị tính ngay khi vẽ (không qua effect)
  DateInput.tsx          ô ngày gõ tắt (25/9/2026, 25/9, 250926, 2509, 25) + nút lịch; KHÔNG bật lịch khi vào ô
  DateRangeFilter.tsx    khoảng ngày + mốc nhanh (hôm nay … năm nay, tất cả, khoảng ngày); rangeOf(value)
  ProductSelect.tsx      chọn một mặt hàng (tìm máy chủ); WarehouseSelect.tsx: WarehouseSelect, GroupSelect
  ReportTable.tsx        BẢNG BÁO CÁO CHUẨN: tiêu đề cố định, dòng tổng cố định, ↑↓/Enter/nhấp mở chi tiết;
                         ReportActions (Xuất Excel đúng bộ lọc + In), OpenHint
  EntityFormModal.tsx    hộp thoại thêm/sửa chuẩn (Enter, Ctrl+S, Esc, lỗi theo ô)
  CatalogList.tsx        trang danh sách chuẩn (tìm, lọc, phân trang, phím, xóa/ngừng dùng) + StatusText, activeColumn
  PageHeader, Kbd, Placeholder
pages/
  dashboard/DashboardPage.tsx
  catalog/               Products, Partners (một màn, hai chế độ customer/supplier), SimpleCatalog (Kho, Nhóm hàng),
                         CashAccounts, Users, rules.ts, useEditor.ts; PartnersPage xuất PartnerFormModal (dùng lại khi thêm nhanh)
  documents/
    docTypes.ts          cấu hình 6 loại phiếu (nhãn, đối tác, kho nhận, có giá?, giá mặc định, phiếu xuất?, có nợ?, cảnh báo lỗ?)
    DocumentListPage     danh sách theo loại + màn "Phiếu tạm đang treo" (draftsOnly)
    DocumentEditor       route /chung-tu/:id và /chung-tu/moi?loai=… (DocumentRoute giữ trình soạn khi phiếu mới được lưu)
    draft.ts             mô hình phiếu đang soạn (HeaderDraft, LineDraft), chuyển qua lại với Document, fingerprint (đã sửa?)
    LineGrid             lưới dòng hàng; ProductCodeInput ô mã hàng + danh sách gợi ý; PartnerSelect ô đối tác (+F4 thêm nhanh)
    PrintSheet           bản in A4/A5 (in qua trình duyệt, #print-root + @media print); HistoryDrawer lịch sử sửa (diff dễ đọc)
  reports/
    drawers.tsx          DrawerStackProvider + useDrawers(): ngăn kéo chi tiết xếp chồng (document | ledger | trade)
    DocumentView         xem nhanh phiếu (chỉ đọc) + "Mở phiếu để sửa"; StockLedgerView thẻ kho; TradeReportView bán/mua
    StockPages           Tồn kho, Thẻ kho, Tổng hợp NXT; OtherReportPages: chi tiết bán/mua, lịch sử bán, Hàng cần đặt, trang Báo cáo
  catalog/CompanySettingsPage   Thông tin công ty (admin); auth/ChangePasswordModal (menu người dùng ở thanh trên)
  vouchers/
    VoucherListPage      danh sách phiếu thu / phiếu chi (sum_total_amount)
    VoucherEditor        /phieu-thu-chi/:id và /phieu-thu-chi/moi?loai=receipt|payment&partner_id=&document_id=
    VoucherView          xem nhanh phiếu thu chi (ngăn kéo); VoucherPrint bản in A5 có "Bằng chữ"
    DebtLedgerView       sổ chi tiết công nợ một đối tác (ngăn kéo), nút Thu tiền / Chi tiền
    MoneyPages           Công nợ phải thu / phải trả (debt-summary), Sổ quỹ / sổ ngân hàng (cash-book)
    voucherText.ts       câu chữ thu chi dùng chung: VOUCHER_TITLE, VOUCHER_PREFIX, DEBT_EFFECT, defaultDebtSide, debtEffect
  GuidePage.tsx          trang Hướng dẫn: hiển thị docs/HUONG_DAN_SU_DUNG.md (một nguồn nội dung, import ?raw)
lib/numberWords.ts       numberToVietnameseWords / moneyInWords (linh, mươi, mốt, lăm; 24 = "hai mươi bốn" — không dùng "tư"; "không trăm" ở nhóm giữa, tỷ lặp)
```

## Quy ước

**Gọi máy chủ.** Chỉ qua `api/*` (không `fetch` ở màn hình). Không dùng `any`; JSON đi qua kiểu trong `api/types.ts`.
Hiển thị lỗi bằng `errorMessage(e)` — `message` của máy chủ luôn là tiếng Việt có dấu; không bao giờ hiện mã lỗi thô.
Lỗi `VALIDATION` có `details.field` ⇒ `EntityFormModal` gắn lỗi vào đúng ô (dùng `fieldMap` nếu tên ô khác) và đưa con trỏ về ô đó.
`IN_USE` khi xóa danh mục ⇒ `CatalogList` đề nghị "Chuyển sang ngừng sử dụng" (PUT đủ trường với `active:false`).
PUT danh mục là thay toàn bộ ⇒ luôn gửi đủ trường.

**Số và ngày.**
- Tiền: `formatMoney` ⇒ `1.234.567`, có số lẻ thì hiện (`13.001,5`). Số lượng: `formatQty` (`1.250,5`; `formatQty(n, true)` ⇒ `50,0` như mẫu phiếu).
- Ô nhập số: luôn `<NumberInput kind="money"|"qty" />`. Hiểu `1.500.000`, `1500000`, `2,5`, `2.5` (phím `.` bàn phím số),
  `150k`, `1,5tr`, `-100.000`; một dấu `.` theo sau đúng 3 chữ số là dấu nghìn (`1.500` = 1500), còn lại là thập phân.
  Vào ô ⇒ bôi đen để gõ đè; rời ô ⇒ định dạng lại; gõ sai ⇒ viền đỏ + gợi ý, rời ô thì quay về số cũ.
- Ngày hiển thị `dd/MM/yyyy` (`formatDate`), gửi lên `YYYY-MM-DD` (`toApiDate`). DatePicker dùng `format={DATE_INPUT_FORMATS}`
  (gõ tắt `141126`, `14/11/26` được). Thời điểm (`*_at`, UTC) hiển thị giờ Việt Nam bằng `formatDateTime` — không phụ thuộc múi giờ máy trạm.
  "Hôm nay" mặc định lấy `todayVn()`.

**Bàn phím** (giữ nhất quán ở mọi màn sau):
| Phím | Ở danh sách | Trong hộp thoại/biểu mẫu |
|---|---|---|
| F2 | Thêm mới | — |
| F3 hoặc `/` | Vào ô tìm kiếm | — |
| ↓ / Enter từ ô tìm | Xuống bảng, chọn dòng đầu | — |
| ↑ ↓ Home End PgUp PgDn | Chọn dòng / đổi trang | — |
| Enter / nhấp đúp | Sửa dòng đang chọn | Sang ô kế tiếp; ở ô cuối ⇒ Lưu |
| Delete | Xóa dòng đang chọn (hỏi lại) | — |
| Ctrl+S | — | Lưu |
| Esc | Xóa nội dung ô tìm | Đóng (danh sách chọn đang mở thì chỉ đóng danh sách) |

`useHotkeys` tự tạm dừng khi có hộp thoại mở và bỏ qua phím ký tự khi đang gõ. `enterToNext` gắn vào `onKeyDownCapture`
của vùng biểu mẫu; bỏ qua ô nhiều dòng, nút, Select/DatePicker đang mở; radio chỉ dừng ở ô đang chọn; Switch đi tiếp (Space bật/tắt).
Ô bọc trong `[data-enter-skip]` bị bỏ qua. Gợi ý phím hiện kín đáo bằng `<Kbd>` (thanh gợi ý dưới bảng, chân hộp thoại, nút F2).

**Giao diện.** Chữ 14px, bảng `size="small"` dòng xen màu, dòng chọn xanh có vạch trái, số căn phải, tiêu đề cột cố định,
bảng cuộn bên trong (thanh phân trang luôn thấy). Trang không cuộn ngang ở 1366×768; màn hẹp hơn thì bảng có `minWidth`
và tự cuộn ngang bên trong. Trạng thái dùng `StatusText` (chấm màu + chữ) để dòng thấp. Câu chữ: từ kế toán quen dùng
(Ghi sổ, Phiếu tạm, Công nợ, Tồn kho, Ngừng sử dụng…), xác nhận xóa nói rõ đối tượng và "không khôi phục được",
thông báo thành công ngắn (1,5 giây), lỗi nói cách khắc phục.

## Chứng từ (giai đoạn 2)

- Một trình soạn cho 6 loại; khác nhau chỉ qua `docTypes.ts`. Danh sách theo loại ở `paths.sales/…`, phiếu mới
  `paths.newDocument(type)` (= `/chung-tu/moi?loai=sale`), mở phiếu `paths.document(id)`.
- **Bàn phím trong phiếu**: Enter đi Ngày → Đối tác → Kho → (Kho nhận) → Ghi chú → dòng 1. Ở lưới: Mã (gõ mã hoặc một
  phần tên, nhiều từ được: "kiswel 3.2"; Enter lấy; gõ đủ mã + Enter không cần chờ danh sách) → Số lượng → Đơn giá → dòng sau
  (luôn có một dòng trống ở cuối). Dòng dịch vụ (`DV`/`DICHVU`): Mã → Diễn giải → Đơn giá (được âm, được để trống).
  ↑↓ đổi dòng cùng cột, Ctrl+Delete xóa dòng, Ctrl+Insert chèn dòng. Ctrl+S Lưu tạm / Lưu thay đổi, F9 Ghi sổ (tự lưu trước),
  F8 Sửa phiếu đã ghi sổ, Ctrl+P xem trước bản in, F2 phiếu mới cùng loại, F4 (ở ô đối tác) thêm đối tác mới.
- **Giá & tồn**: chọn mã ⇒ điền giá mặc định ngay (giá bán / giá mua theo loại); `price-info` (theo ngày phiếu) cho cột Tồn
  (kho đang chọn / tổng), gợi ý "giá mua …" và cảnh báo "Bán lỗ" (phiếu bán). Phiếu xuất đánh dấu "Thiếu x — tồn y" khi
  gộp SL theo mã vượt tồn của kho (phiếu đã ghi sổ đang sửa: cộng lại SL cũ của chính nó). Phiếu tạm đã lưu còn gọi
  `/check` (chính xác, tính cả các ngày sau) và hiện ở chân phiếu.
- **Lỗi máy chủ**: `LOSS_WARNING` ⇒ hộp xác nhận liệt kê dòng, đồng ý thì gửi lại với `confirm_loss`; `INSUFFICIENT_STOCK` ⇒
  hộp thoại `message` từng mã (+ gợi ý phiếu vẫn là phiếu tạm / Hàng cần đặt); `VALIDATION` có `line_no` ⇒ tô đỏ đúng dòng
  và đặt con trỏ; `VERSION_CONFLICT` ⇒ giải thích + "Tải bản mới", các dòng đang gõ được giữ trong khung vàng (Thêm lại /
  Chép ra Excel); `IN_USE` khi xóa ⇒ nêu số phiếu thu/chi.
- **Hai máy**: SSE làm mới `['document', id]`; trình soạn so `version`: không có thay đổi chưa lưu ⇒ tự nạp bản mới + báo
  ngắn; đang sửa dở ⇒ dải cảnh báo "Phiếu vừa được X sửa lúc …" (không ghi đè chữ đang gõ); phiếu bị xóa ⇒ báo và khóa.
- **Chặn rời trang** khi có thay đổi chưa lưu: `useBlocker` (điều hướng trong app) + `beforeunload` (đóng tab).
- **In**: luôn in dữ liệu đã lưu (có thay đổi chưa lưu ⇒ nhắc lưu trước). Phiếu tạm in tiêu đề "PHIẾU TẠM (chưa ghi sổ)",
  phiếu đã ghi sổ in tiêu đề chính thức như file xuất của máy chủ. Thông tin công ty ở `PrintSheet.tsx` (`COMPANY`) là chỗ
  giữ sẵn. Excel/Word tải từ `/api/documents/{id}/export`.
- Kho mặc định của phiếu mới = kho dùng lần trước cho loại phiếu đó trên máy này (`localStorage`).

## Báo cáo và ngăn kéo chi tiết (giai đoạn 3)

- **Mọi báo cáo** dùng `ReportTable` + `ReportActions` và nằm trong `.report-area` (để In chỉ in vùng này, khổ ngang,
  đủ mọi dòng — `printReport()` trong `lib/download.ts`). Excel luôn là file của máy chủ với **đúng tham số đang lọc**
  (`reportApi.xlsxUrl(name, params)`). Khi "Tất cả" thời gian ở báo cáo bán/mua/NXT phải gửi `from=2000-01-01`
  (bỏ trống thì máy chủ mặc định tháng này).
- **Mở chi tiết không rời trang**: `const drawers = useDrawers(); drawers.push({kind:'document', id})`,
  `{kind:'ledger', product, warehouseId?, from?, to?}`, `{kind:'trade', report:'sales'|'purchases', product}`.
  Ngăn kéo chồng lên nhau (mỗi tầng hẹp hơn 48px), **Esc đóng từng tầng** (bỏ qua khi có hộp thoại / danh sách chọn
  đang mở). "Mở phiếu để sửa" đóng hết ngăn kéo rồi điều hướng. Giai đoạn 4 thêm `{kind:'voucher'}`, `{kind:'debt'}` ở đây.
- Báo cáo tự cập nhật qua SSE (khóa `['reports', …]`); kiểm tra phiếu đang gõ dùng khóa `['document-check', …]`.
- **Trình soạn phiếu**: `price-info?ids=` một lần cho cả phiếu (khóa `['price-info','batch',…]`); danh sách gợi ý mã
  dùng `with_stock` (tồn kho của phiếu / tổng); gợi ý thiếu hàng / bán lỗ từ `POST /documents/check` (trễ 450ms, gửi
  `id` khi sửa phiếu có sẵn ⇒ thấy cả xung đột sửa lùi ngày sau). `required = 0` (sửa lùi phiếu nhập) ⇒ hiện
  "Làm âm kho x (ngày …)" và `message` của máy chủ. F6 thẻ kho, F7 lịch sử bán/mua của dòng đang đứng; Alt+↑/↓ dời dòng;
  cột "Ghi chú dòng" bật/tắt (nhớ theo máy, tự hiện nếu phiếu có ghi chú).
- **Ô chọn (Select/AutoComplete) trong biểu mẫu**: MỘT lần Enter vừa lấy mục đang sáng vừa sang ô kế tiếp
  (`enterToNext`); nếu không có mục nào sáng thì Enter không làm gì.
- Phiếu nhập từ "Hàng cần đặt": `navigate(paths.newDocument('purchase'), { state: { prefill: { lines:[{product_id, qty}], note } } })`.

## Thu chi và công nợ (giai đoạn 4)

- **Phiếu thu/chi có hiệu lực ngay khi lưu** (không có phiếu tạm). Trình soạn: loại THU/CHI, tài khoản (nút lớn
  Tiền mặt / Ngân hàng — quyết định số PT/PC/BC/BN, hiện ngay "Số phiếu: PT…"), ngày, đối tác (bỏ trống = thu/chi khác),
  ghi chú, nhiều dòng {diễn giải → Enter → số tiền → Enter → dòng sau; "chứng từ liên quan" là ô chọn tùy chọn, chỉ
  phiếu đã ghi sổ của đối tác đó; chọn phiếu ⇒ tự điền số tiền + diễn giải nếu đang trống}.
- **`debt_side` luôn gửi rõ.** Mặc định như máy chủ (`defaultDebtSide`); chỉ hỏi người dùng khi có ý nghĩa: phiếu THU
  từ đối tác là NCC, phiếu CHI cho đối tác là KH (câu chữ ở `DEBT_EFFECT`). Công nợ "trước phiếu → sau phiếu" tính từ
  `debt-ledger` (đến ngày phiếu) trừ ảnh hưởng của chính phiếu đang sửa.
- Từ phiếu bán/mua đã ghi sổ: "Thu tiền phiếu này" / "Chi tiền phiếu này" ⇒ `paths.newVoucher(type, {document_id})`.
  Từ sổ công nợ: nút Thu tiền / Chi tiền ⇒ `paths.newVoucher(type, {partner_id})`.
- Ngăn kéo thêm `{kind:'voucher', id}` và `{kind:'debt', partner, side, from?, to?}`. Báo cáo công nợ → sổ chi tiết →
  phiếu/phiếu thu chi, Esc đóng từng tầng. Danh mục đối tác và ô đối tác trong phiếu có "Xem công nợ".
- **Tiêu đề in báo cáo** dùng `<PrintTitle title filters={[...]} />`: luôn liệt kê mọi bộ lọc đang dùng + giờ in.
- **Lần đầu dùng** (CSDL mới): Tổng quan hiện khung "Bắt đầu sử dụng" 5 bước, tự đánh dấu theo dữ liệu thật, tự ẩn khi xong
  (hoặc người dùng bấm "Ẩn hướng dẫn này" — nhớ theo máy).
- Lưới dòng (phiếu kho và phiếu thu chi) chuyển con trỏ bằng `useLayoutEffect` để người gõ nhanh không mất phím.

### Sửa sau kiểm thử E2E (F-01, F-04…F-08)

- **Tìm rồi Enter không bao giờ dùng kết quả cũ** (`lib/searchGuard.ts`): ô chọn tìm trên máy chủ (`PartnerSelect`,
  `ProductSelect`) đánh dấu `data-search-pending` khi kết quả chưa phải của chữ đang gõ; Enter lúc đó được ghi nhớ, kết quả
  đúng về mới chọn mục đầu (thứ tự máy chủ) rồi `focusNextField`; không có kết quả ⇒ không chọn. Ô tìm ở màn danh sách
  (`useListSearchEnter`): Enter bỏ thời gian chờ (`useDebouncedFlush`), chờ dữ liệu của đúng bộ lọc rồi mới xuống dòng đầu;
  Enter hai lần ⇒ mở dòng đầu. Ô mã hàng trong lưới tự kiểm (`resultsFor`). Lọc tại máy (Select kho, nhóm…) dùng
  `filterByLabel` / `matchText` (lib/text.ts): không dấu, nhiều từ, thứ tự bất kỳ, bỏ dấu câu.
- **Xung đột hai máy**: khung vàng chỉ có thay đổi của máy này (thêm / sửa / xóa); gộp ba chiều — xem "Sửa vòng 2".
- **Phiên hết hạn khi đang gõ**: `lib/unsavedStore.ts` lưu phiếu đang gõ dở vào sessionStorage theo người dùng + phiếu,
  khôi phục khi đăng nhập lại đúng người đó; xóa khi lưu, bỏ thay đổi, xóa phiếu, đăng xuất chủ động.
- **Phiếu mới**: giá trị phần mềm tự điền (kho / tài khoản mặc định, điền sẵn từ "Thu tiền", "Thu tiền phiếu này",
  "Hàng cần đặt") là mốc (`autoFill` + `pristine`) ⇒ chưa gõ gì thì rời đi không bị hỏi.
- **Xóa phiếu**: tắt truy vấn trước khi gửi lệnh xóa; sự kiện SSE `deleted` gỡ phiếu khỏi bộ nhớ đệm thay vì tải lại.
  Màn đăng nhập không gọi `/auth/me` nếu trình duyệt chưa từng đăng nhập / đã đăng xuất (cờ `kho.hadSession`).
- Màn hẹp ≤1100px: nút ít dùng của phiếu gom vào "Thêm ▾" (`useNarrow`). In trong ngăn kéo chi tiết chỉ in ngăn kéo đó.
- Kiểm tra đọc số thành chữ: `npm run test:words`.

### Sửa vòng 2 (F-09…F-16)

- **Gộp ba chiều** (`lib/merge3.ts`, F-10): so dòng lúc nạp (base) / máy này (mine) / bản máy kia vừa lưu (theirs) theo
  **từng ô**. Một dòng được nhận ra **chỉ bằng id dòng máy chủ** (`LineDraft.id`, `VLine.id`; máy chủ giữ id khi sửa phiếu
  nếu body gửi kèm `id`); dòng không có id, hoặc id không có trong bản lúc nạp, là dòng mới. Không ghép theo mã hàng hay vị
  trí. Chỉ tôi sửa ⇒ của tôi; chỉ máy kia sửa ⇒ của máy kia; cả hai sửa khác nhau ⇒ mục "Cùng sửa: <ô> — máy kia: X, bạn: Y"
  với lựa chọn (`MergeChoicePicker`, mặc định "Giữ của máy kia"); tôi sửa / máy kia xóa và ngược lại ⇒ cũng hỏi, mặc định
  giữ bản đã lưu. Thứ tự dòng (Alt+↑↓): chỉ một bên đổi ⇒ theo bên đó; cả hai đổi khác nhau ⇒ hỏi. Sửa không bao giờ thêm
  dòng; dòng thêm lại sau khi máy kia xóa đi lên máy chủ như dòng mới (không mang id cũ). Dùng chung cho phiếu kho
  (`DOC_FIELDS`, `mergeLines`) và phiếu thu chi (`V_FIELDS`). Kiểm tra: `npm run test:merge`.
- **Id dòng khi lưu**: `toBody` (phiếu kho) và `body()` (phiếu thu chi) luôn gửi `id` của dòng đang có — kể cả sau khi gộp
  và sau khi khôi phục phiếu gõ dở (dòng khôi phục mang lại id lúc nạp) — nên máy chủ sửa tại chỗ, giữ id.
- **Ô chọn có tìm** (`useSearchEnterGuard`, F-11): khi đang có chữ gõ, ô tự xử lý Enter (`data-search-owner`, `enterToNext`
  bỏ qua): kết quả chưa đúng chữ ⇒ chờ; đúng ⇒ chọn mục đầu (hoặc mục người dùng dời tới bằng ↑ ↓); không có kết quả ⇒
  giữ chữ. Đang gõ thì không ghim mục đang chọn vào danh sách. `searchValue` được điều khiển để xóa chữ sau khi chọn.
- **Danh sách** (`useActiveRow`, F-15): dòng đang chọn có bản sao trong ref ⇒ Enter thứ hai đến trước khi vẽ lại vẫn mở.
- **Mặt hàng** (F-13, F-16): `q` gửi nguyên chữ (máy chủ tìm theo từ); ô Mã hàng tra mã chính xác bằng
  `GET /products/lookup?optional=1` (không 404 khi gõ từng chữ).
- **Khôi phục phiếu gõ dở** (F-14): `unsavedStore.markSessionEnded()` khi gặp 401; lý do = phiên ngắt sau lần lưu tạm cuối
  ⇒ "Phiên đăng nhập đã hết…", ngược lại "…từ lần mở trước". Phiếu mới khôi phục: con trỏ ở dòng trống cuối.
- **Con trỏ ban đầu đến muộn** không giành con trỏ khi người dùng đã bấm vào một ô (`userIsTyping`) — trước đây gõ ngày
  ngay khi mở phiếu thu đôi khi bị chuyển sang ô đối tác.
- Bản in: bỏ phần địa chỉ / ĐT trống (F-09).

### Sửa vòng 3 (F-17…F-19)

- **F-19 — bộ nhớ phiếu gõ dở chỉ chứa thứ người dùng đã gõ.** Nguyên nhân: mốc "chưa đổi" (`pristine`) của phiếu mới được
  cập nhật trong effect, nên khi phần mềm tự điền (kho / tài khoản mặc định) có một lần vẽ "dirty" giả; effect ghi bộ nhớ chạy
  đúng lần đó ⇒ phiếu TRỐNG được ghi rồi ~10 ms sau mới xóa. Rời trang / tải lại / người khác đăng nhập trong khe đó ⇒ lần mở
  sau "khôi phục" phiếu trống. Sửa: mốc lấy ngay trong lần vẽ có giá trị tự điền (`markAuto()` + `pristineRef`); chỉ ghi khi
  dirty VÀ có nội dung thật (khách / ghi chú / dòng); mọi lần ghi, đọc gắn với `ownerId` chốt lúc mở màn phiếu (bản lưu có
  `userId`); khôi phục chỉ khi đúng người, có nội dung và khác bản đang có — ngược lại xóa bản lưu. Phiên hết ⇒ cả ứng dụng
  thay bằng màn đăng nhập nên màn phiếu cũ bị gỡ (không có lần ghi nào chờ — việc ghi không trì hoãn). Phiếu gõ dở của người
  trước giữ nguyên trong tab, người đó đăng nhập lại thì được khôi phục.
- **F-17**: `PartnerSelect` / `ProductSelect` điều khiển `open`: chọn xong là đóng hẳn, không mở lại khi danh mục đầy đủ tải
  về; ô ngoài biểu mẫu giữ con trỏ (bỏ cách blur/focus).
- **F-18**: đang sửa phiếu đã ghi sổ (F8) mà "Tải bản mới" còn thay đổi chưa đưa vào ⇒ vẫn ở chế độ sửa, có nút gộp.
- Gộp: dòng máy kia đã xóa mà chọn "Dùng của tôi" được đặt lại chỗ cũ (sau dòng đứng trước nó lúc nạp).

### Từ ngữ thống nhất

| Dùng | Không dùng |
|---|---|
| Ghi sổ / Bỏ ghi sổ / Đã ghi sổ | duyệt, hoàn tất, chốt |
| Phiếu tạm (số TAM…) | nháp, phiếu nháp |
| Nợ cũ, Tổng nợ (trên phiếu bán/mua) | dư nợ trước |
| Phải thu (khách nợ mình) / Phải trả (mình nợ NCC) | công nợ khách / công nợ NCC lẫn lộn |
| Tăng / Giảm / Còn nợ (bảng công nợ) | Nợ / Có |
| Thu tiền / Chi tiền; Tiền mặt / Ngân hàng | thanh toán, giao dịch |
| Tồn kho, Thẻ kho, Tồn đầu kỳ | số lượng hiện có |
| Ngừng sử dụng | vô hiệu hóa, khóa (trừ tài khoản người dùng: "Khóa") |

## Cache & cập nhật trực tiếp

Khóa (`api/queryKeys.ts`) có phần tử đầu là "miền" để làm mới theo tiền tố:
`['catalog', entity, …]` (entity = `warehouse|product_group|product|partner|cash_account|user`), `['price-info', id, date]`,
`['documents', …]`, `['document', id]`, `['vouchers', …]`, `['voucher', id]`, `['reports', tên, params]`, `['dashboard']`.
Màn mới **phải** đặt khóa theo quy ước này thì mới tự cập nhật.

`EventsProvider` (bọc toàn bộ phần đã đăng nhập) giữ **một** `EventSource('/api/events')`:
- `catalog.changed` ⇒ `['catalog', entity]` (+ `price-info`/`reports`/`dashboard` khi liên quan);
- `document.changed` ⇒ `documents`, `document/id`, `price-info`, `reports`, `dashboard`;
- `voucher.changed` ⇒ `vouchers`, `voucher/id`, mọi `document` (nợ cũ), `reports`, `dashboard`.
- Mất kết nối ⇒ chấm đỏ "Mất kết nối" trên thanh trên; trình duyệt tự nối lại, nếu kết nối đã đóng hẳn thì tự nối lại sau
  3s → 6s → … tối đa 30s (kiểm tra phiên trước, 401 ⇒ về đăng nhập). Nối lại được ⇒ làm mới mọi dữ liệu (có thể đã lỡ sự kiện).
- Màn cần phản ứng riêng (vd. đang mở phiếu mà máy khác sửa): `useServerEvent((e) => { if (e.type === 'document.changed' && e.id === id && e.by_id !== me.id) … })`.

## Thêm một màn hình (giai đoạn sau)

1. Thêm/đổi đường dẫn trong `paths.ts` (các đường dẫn đã có giữ nguyên).
2. Trong `routes.tsx` thay `soon('…')` của mục đó bằng component thật.
3. Hàm gọi API + kiểu vào `api/` (kiểu chứng từ, `Shortage`, `LossWarning`, `VersionConflictDetails`, `DocumentSummary` đã có sẵn).
4. Danh sách dùng `CatalogList` hoặc cùng quy ước (ô tìm F3, bảng có phím, `PageHeader`); ô tiền/số lượng dùng `NumberInput`.

## Kiểm tra trên trình duyệt

Giai đoạn 2: ảnh ở `frontend/screenshots/stage2/` (kèm PDF in thử, file xlsx/docx tải về).
Giai đoạn 3: `frontend/screenshots/stage3/` (thẻ kho mẫu của khách, tồn 4 kho, chồng ngăn kéo, file Excel từng báo cáo, PDF in thẻ kho).
Giai đoạn 4: `frontend/screenshots/stage4/` (thu chi nhiều dòng, hoàn tiền, công nợ, sổ quỹ, in phiếu thu A5, xung đột hai máy, CSDL mới, máy tính bảng 820px).


Ảnh chụp 1366×768 (và máy tính bảng 820×1180) ở `frontend/screenshots/stage1/`. Đã chạy bằng Playwright (Chromium) với
máy chủ thật: đăng nhập sai/đúng, thêm/sửa/xóa từng danh mục bằng bàn phím, lỗi trùng mã, thiếu ĐVT, bỏ cả KH/NCC,
mật khẩu ngắn, hạ quyền admin cuối, xóa mục đã dùng ⇒ ngừng sử dụng, tìm không dấu, phân quyền kế toán, hai trình duyệt
(máy 2 thấy kho/phiếu tạm mới < 0,5 giây), tắt rồi bật lại máy chủ (tự nối lại), khóa tài khoản đang dùng (về đăng nhập).

## Bản mở rộng — đợt M1 (SPEC_MO_RONG.md: §0, C1, C4, C3)

Nguyên tắc: **mọi tính năng tắt ⇒ giao diện y như bản chuẩn** (không thêm menu, nút, cột, lệnh gọi lỗi). Chỉ một ngoại lệ có
chủ ý: quản trị thấy thêm **Danh mục › Tính năng mở rộng** ở cả bản chuẩn (để bật tính năng). API của tính năng tắt trả
404 `FEATURE_OFF` ⇒ giao diện **không gọi** khi tắt (vd. `/period-lock` chỉ gọi khi `period_lock` bật).

- **Trạng thái** (`auth/AuthContext.tsx`): `/auth/me` trả `features` + `permissions`; lệnh đăng nhập chỉ trả người dùng nên
  đăng nhập xong gọi thêm `/auth/me`. `useAccess()` (features, permissions, `can`, `on`, `isAdmin`), `useFeature(key)`,
  `useCan(perm)`. Máy chủ cũ / bản chuẩn không gửi `permissions` ⇒ coi như đủ quyền. SSE `features` (quản trị đổi tính năng,
  ma trận quyền, ngày khóa sổ) ⇒ `refresh()` đọc lại `/auth/me` + làm mới mọi query (số liệu bị che khác đi).
- **Màn & menu** (`auth/guard.tsx`): `ScreenDef.need = { feature?, all?, any? }`; menu ẩn mục không đủ điều kiện (nhóm rỗng
  ẩn luôn); mở thẳng đường dẫn ⇒ `GuardedScreen` báo "Bạn không có quyền xem màn hình này" kèm tên quyền tiếng Việt.
  Thẻ ở trang Báo cáo dùng cùng điều kiện.
- **Chứng từ theo quyền**: `docAccess(type)` ⇒ `{cfg, canWrite, canEditPosted, costHidden}`. Không có `cost.view` với phiếu
  mua / trả NCC / tồn đầu ⇒ `cfg.hasPrice = false` (bỏ cột Đơn giá/Thành tiền, dòng Cộng, giống phiếu chuyển kho — khớp file
  xuất của máy chủ), không có `debt.view` ⇒ bỏ Nợ cũ/Tổng nợ. Dùng ở DocumentListPage, DocumentEditor, PrintSheet, DocumentView.
  Editor: `mayEdit` (phiếu tạm: quyền lập loại đó; đã ghi sổ: thêm `posted.edit`, ngoài kỳ khóa) quyết định chỉ xem; ẩn F2,
  F8, F9, Bỏ ghi sổ, Xóa, "Thu/Chi tiền phiếu này" (`cash.write`); không gọi `/documents/check`, sổ công nợ khi không có quyền.
  Bán lỗ khi giá mua bị che: "Bán lỗ (thấp hơn giá mua)" không kèm số. Ô tiền bị che (null) ⇒ "—" hoặc bỏ cột, không bao giờ
  "null"/"0"/NaN. Lập phiếu mới không có quyền ⇒ trang 403.
- **Danh mục**: `CatalogList` không có `catalog.write` ⇒ chỉ xem (không Thêm/Sửa/Xóa, F2). Giá mua (hàng hóa), nợ đầu kỳ (đối
  tác: phải thu cần `debt.view`, phải trả thêm `cost.view`), số dư đầu kỳ (tài khoản tiền: `cash.view`) bị ẩn; khi lưu gửi
  `null` để máy chủ giữ số cũ. `PartnerSelect` không thêm tại chỗ (F4) khi thiếu `catalog.write`.
- **Phiếu thu chi**: không có `cash.write` hoặc phiếu trong kỳ khóa ⇒ chỉ xem (`ReadOnlyWrap` = `<fieldset disabled>`
  `display: contents`, chỉ thêm vào DOM khi chỉ xem); công nợ trước/sau phiếu chỉ khi được xem công nợ.
- **Tổng quan**: ô doanh thu / công nợ / quỹ bị che (null) thì không hiện.
- **Màn mới** (`pages/extended/`): `FeaturesPage` (mô tả bằng lời thường, hộp xác nhận nói rõ tác dụng; 409 `IN_USE` khi tắt
  phân quyền ⇒ nêu tên người dùng, hỏi lại rồi gửi `confirm: true`; tính năng `available: false` hiện mờ "Sắp có"),
  `PermissionsPage` (ma trận vai trò × quyền, cột Quản trị khóa, "Về mặc định", Ctrl+S), `PeriodLockPage` (ngày khóa, lý do
  bắt buộc, khóa / đổi / bỏ; lịch sử hiện nếu máy chủ trả `history`), `ImportPage` (3 bước; tự thử khi chọn file; tiến độ tải
  lên qua `api.upload` (XMLHttpRequest); bảng lỗi lọc theo cột / chữ; "Nhập N dòng" chỉ bật khi hết lỗi; tồn đầu kỳ: chọn ngày,
  sau khi nhập có đường dẫn tới từng phiếu tạm).
- **Khóa sổ** (`lib/periodLock.tsx`): `useLockDate()`, `isLocked`, `LockBadge` (dòng "Lập: …" của phiếu), cảnh báo ngay dưới ô
  ngày khi chọn ngày trong kỳ khóa, nút Sửa/Ghi sổ/Bỏ ghi sổ/Lưu/Xóa mờ kèm chú thích; 422 `PERIOD_LOCKED` ⇒ hộp "Kỳ này đã
  khóa sổ" + lỗi ở ô ngày. Ô nợ đầu kỳ / số dư đầu kỳ bị khóa khi đang khóa sổ (máy chủ không cho đổi).
- Mã lỗi mới trong `api/client.ts`: `FEATURE_OFF`, `PERIOD_LOCKED`, `IMPORT_INVALID` (câu dự phòng tiếng Việt).

## Bản mở rộng — đợt M2 (C5, C6, C8, C7) và việc tiếp M1

- **Việc tiếp M1**: đăng nhập dùng luôn `permissions`/`features` trong phản hồi `/auth/login` (máy chủ cũ không có ⇒ gọi
  `/auth/me`); Khóa sổ hiện bảng lịch sử (`history`: người, lúc, ngày cũ → ngày mới, lý do); người không có `cost.view` không
  thấy Sửa phiếu / Bỏ ghi sổ ở phiếu mua, trả NCC, tồn đầu đã ghi sổ (`docAccess.canEditPosted`), có dòng giải thích.
- Trường mới (`min_stock`, `credit_limit`, `payment_days`) chỉ gửi khi tính năng bật (không gửi ⇒ máy chủ giữ; `null` ⇒ xóa).
- **C5** (`min_stock`): ô + cột "Tồn tối thiểu" (Hàng hóa); Tồn kho tô `row-low` các mã trong `/reports/low-stock` (chỉ khi
  xem đến hôm nay); ô Tổng quan theo `low_stock_rule`; màn `LowStockPage` (`/bao-cao/duoi-ton-toi-thieu`); Hàng cần đặt có cột
  Tồn tối thiểu / Cần đặt thêm, số đặt = max(thiếu, `order_more`).
- **C6** (`price_list`): `PartnerPrices.tsx` — bảng giá riêng (sửa tại chỗ, lưu khi rời ô; thêm bằng ô tìm mặt hàng; bỏ), mở
  từ nút nhãn giá ở danh sách khách và "Bảng giá riêng…" trong hồ sơ khách; loại nhập Excel `partner_prices`. Phiếu bán:
  `/products/sale-price` (một lần gọi cho mọi mã của phiếu); dòng vừa chọn mã (LineGrid `onPicked`) được đánh dấu "giá tự điền"
  và thay bằng giá theo khách khi có — sửa tay thì thôi; dưới ô giá: nguồn giá hoặc "Lưu giá này cho khách" (`sale.write`,
  `tabIndex=-1` để không chen vào chuỗi Enter). Đổi khách khi đã có dòng ⇒ hỏi lấy lại giá. Luồng Enter / F7 không đổi.
- **C8** (`credit_limit`): ô Hạn mức nợ / Số ngày được nợ (khách); đầu phiếu bán "Nợ hiện tại / Hạn mức" (chỉ khi xem được
  công nợ), đỏ khi vượt; 409 `CREDIT_WARNING` ⇒ `confirmCredit` (một hộp, kèm dòng bán lỗ nếu có), gửi lại mọi cờ trong
  `details.confirm` (`confirm_credit` chỉ gửi khi đã xác nhận). Không có quyền xem công nợ ⇒ chỉ câu báo, không số.
  `DebtAgingPage` (`/bao-cao/tuoi-no`) + ngăn kéo `aging` (khoản còn mở ⇒ chứng từ / phiếu thu chi).
- **C7** (`profit_report`): `ProfitPage` (`/bao-cao/lai-gop`, cần `report.view` + `cost.view`): ba nhóm (Segmented), khoảng
  ngày, dòng Cộng, dấu "ước tính" có chú thích, giải thích cách tính giá vốn; theo mặt hàng / theo khách ⇒ ngăn kéo `profit`
  (lãi từng phiếu) ⇒ chứng từ. Xuất Excel bằng `format=xlsx` của máy chủ.
- Thẻ mới ở trang Báo cáo dùng `need.feature` ⇒ bản chuẩn không thấy.
