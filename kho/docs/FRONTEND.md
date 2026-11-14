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
App.tsx                  ConfigProvider(vi_VN, theme) → AntApp → QueryClient → Router → Auth → Events → Routes
theme.ts                 token màu/cỡ chữ/bảng (một chỗ)
styles.css               CSS toàn cục (khung, bảng, ô thống kê, trang danh sách); không CSS-in-JS riêng
paths.ts                 MỌI đường dẫn màn hình (paths.sales, paths.document(id)…) — không viết chuỗi URL ở nơi khác
routes.tsx               menu trái + route + tiêu đề trang, một bảng duy nhất (`menu`, `hiddenScreens`)
api/
  client.ts              fetch duy nhất: ApiError {status, code, message, details, field, lineNo}, 401 ⇒ về đăng nhập,
                         lỗi mạng ⇒ câu tiếng Việt; `api.get/post/put/del`
  types.ts               kiểu dữ liệu đúng docs/API.md (danh mục, chứng từ, cảnh báo, thiếu hàng, dashboard, sự kiện SSE)
  catalog.ts             hàm gọi danh mục, người dùng, dashboard, báo cáo tồn (dựng trên `api`)
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
components/
  NumberInput.tsx        ô số kiểu Việt Nam (dùng cho MỌI ô tiền/số lượng)
  EntityFormModal.tsx    hộp thoại thêm/sửa chuẩn (Enter, Ctrl+S, Esc, lỗi theo ô)
  CatalogList.tsx        trang danh sách chuẩn (tìm, lọc, phân trang, phím, xóa/ngừng dùng) + StatusText, activeColumn
  PageHeader, Kbd, Placeholder
pages/
  dashboard/DashboardPage.tsx
  catalog/               Products, Partners (một màn, hai chế độ customer/supplier), SimpleCatalog (Kho, Nhóm hàng),
                         CashAccounts, Users, rules.ts, useEditor.ts
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

Ảnh chụp 1366×768 (và máy tính bảng 820×1180) ở `frontend/screenshots/stage1/`. Đã chạy bằng Playwright (Chromium) với
máy chủ thật: đăng nhập sai/đúng, thêm/sửa/xóa từng danh mục bằng bàn phím, lỗi trùng mã, thiếu ĐVT, bỏ cả KH/NCC,
mật khẩu ngắn, hạ quyền admin cuối, xóa mục đã dùng ⇒ ngừng sử dụng, tìm không dấu, phân quyền kế toán, hai trình duyệt
(máy 2 thấy kho/phiếu tạm mới < 0,5 giây), tắt rồi bật lại máy chủ (tự nối lại), khóa tài khoản đang dùng (về đăng nhập).
