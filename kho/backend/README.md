# Backend — Phần mềm Quản lý Kho / Bán hàng / Công nợ / Thu chi

Go 1.24 · chi · pgx/v5 · PostgreSQL 16 · shopspring/decimal · excelize (xlsx) · .docx tự sinh (archive/zip).
Đặc tả: `../docs/SPEC.md` · API thực tế: `../docs/API.md` · Quyết định kỹ thuật: `../docs/QUYET_DINH.md` · Nghiệm thu: `../docs/NGHIEM_THU.md`.

## Cấu trúc

```
cmd/khoserver     máy chủ: migrate + seed khi khởi động, phục vụ /api và file tĩnh SPA
cmd/seeddemo      nạp dữ liệu mẫu (vật tư hàn) để trình diễn
internal/
  migrations      SQL migration nhúng (embed)
  db              kết nối pool, migrate, seed, cấp số chứng từ, audit
  auth            người dùng, đăng nhập, phiên (bcrypt)
  catalog         kho, nhóm VTHH, mặt hàng, đối tác, tài khoản tiền
  docs            chứng từ kho: phiếu tạm, ghi sổ, sửa quá khứ, bỏ ghi sổ, kiểm tra
  stock           kiểm tra tồn không âm (R6), khóa advisory, giá vốn so sánh (R4)
  debt            công nợ phải thu / phải trả tính động (R8)
  cash            phiếu thu / chi nhiều dòng (R9)
  reports         tồn kho, NXT, thẻ kho, mua/bán, công nợ, sổ quỹ, hàng cần đặt, dashboard
  export          xuất .xlsx / .docx
  events          SSE broker
  httpapi         router, handler, xác thực, file tĩnh
  apperr, util    lỗi chuẩn (tiếng Việt), kiểu ngày, chuẩn hóa tìm kiếm không dấu
tests/            test tích hợp chạy trên PostgreSQL thật qua HTTP (tên test gắn mã REQ)
```

Không có số tồn hay công nợ nào được lưu sẵn: mọi con số tính từ `stock_movements` (chỉ chứng từ đã ghi sổ) và các chứng từ / phiếu thu chi.

## Chạy

Yêu cầu: Go 1.24, PostgreSQL 16 (CSDL `kho_dev` do role `kho` sở hữu). Nếu Postgres tắt: `pg_ctlcluster 16 main start`.

```bash
cd backend
go run ./cmd/khoserver                 # http://localhost:8080 , đăng nhập admin / admin123
```

Biến môi trường:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | `postgres://kho:kho@127.0.0.1:5432/kho_dev` | CSDL |
| `LISTEN_ADDR` | `:8080` | địa chỉ lắng nghe (các máy khác mở `http://<ip-máy-chủ>:8080`) |
| `ADMIN_PASSWORD` | `admin123` | mật khẩu `admin` khi seed lần đầu (CSDL chưa có người dùng) |
| `STATIC_DIR` | `../frontend/dist` | thư mục giao diện đã build; thiếu thư mục thì `/` trả 404 thông báo, `/api` vẫn chạy |
| `COOKIE_SECURE` | (trống) | `true` nếu chạy sau HTTPS |

Khi khởi động server tự chạy migration (`internal/migrations/*.sql`) và seed: admin, 4 kho `KHO1..KHO4`, mã dịch vụ `DV`, tài khoản tiền `TM`, `NH`.

Build một file chạy: `go build -o khoserver ./cmd/khoserver`.

### Dữ liệu mẫu để demo

```bash
go run ./cmd/seeddemo -reset     # XÓA SẠCH dữ liệu trong DATABASE_URL rồi nạp mẫu (chỉ dùng cho CSDL demo!)
go run ./cmd/seeddemo            # nạp vào CSDL chưa có chứng từ (từ chối nếu đã có)
```

Gồm: 6 nhóm VTHH, 20 mặt hàng (que hàn, dây hàn, béc, súng, máy hàn, phụ kiện, bảo hộ), 11 đối tác (có đúng các khách trong ví dụ của khách:
"CTY TNHH TM DV VĨNH PHONG", "CHÚ NGỌC MINH", "CÔNG TY TNHH NHỰA PHẠM GIA - Phường Bình Hưng Hòa B"), tồn đầu kỳ ở cả 4 kho, phiếu mua/bán/trả hàng/chuyển kho đã ghi sổ
(trong đó thẻ kho mã `WW829HT107k` tại KHO1 tái hiện đúng ví dụ 27 → 23 → 20 → 21 → 20, và phiếu bán 25/09/2026 đúng mẫu 3.990.000 / tổng nợ 5.990.000),
3 phiếu tạm đang treo (một phiếu thiếu hàng), 5 phiếu thu/chi nhiều dòng.
Người dùng: `admin/admin123`, `lan/123456` (Máy 1), `hoa/123456` (Máy 2).

## Kiểm thử

```bash
cd backend
gofmt -l .                        # phải rỗng
go vet ./...
go build ./...
go test ./... -count=1            # cần PostgreSQL; dùng TEST_DATABASE_URL (mặc định postgres://kho:kho@127.0.0.1:5432/kho_test)
go test ./... -count=1 -race
go test ./tests -run 'TestREQ012' -v   # chạy test theo mã yêu cầu
```

Mỗi test tạo **một schema PostgreSQL riêng** trong `kho_test` (`search_path`), chạy migrate + seed, rồi xóa schema khi xong — các test độc lập và chạy song song.
Role `kho` cần quyền `CREATE` trên CSDL test (là chủ CSDL là đủ).

Test đi qua HTTP thật (`httptest.Server` + handler của `khoserver`, cookie phiên riêng cho mỗi "máy"), kiểm tra số liệu bằng decimal, mở lại file
`.xlsx` bằng excelize và giải nén `.docx` kiểm tra `word/document.xml` có `<w:tbl>` chứa dữ liệu.
Ma trận mã yêu cầu ↔ test: `../docs/NGHIEM_THU.md`.
