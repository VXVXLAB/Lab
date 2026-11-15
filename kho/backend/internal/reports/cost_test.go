package reports

import (
	"testing"

	"github.com/shopspring/decimal"
)

func ev(id int64, typ, qty, amount string) costEvent {
	return costEvent{lineID: id, docType: typ, qty: decimal.RequireFromString(qty), amount: decimal.RequireFromString(amount)}
}

func wantUnit(t *testing.T, got map[int64]costResult, id int64, unit string, est bool) {
	t.Helper()
	r, ok := got[id]
	if !ok {
		t.Fatalf("dòng %d: không có giá vốn", id)
	}
	if !r.unit.Round(6).Equal(decimal.RequireFromString(unit).Round(6)) || r.estimated != est {
		t.Fatalf("dòng %d: giá vốn %s ước tính %v, muốn %s %v", id, r.unit, r.estimated, unit, est)
	}
}

// Các kịch bản tính tay của bình quân gia quyền liên hoàn (SPEC_MO_RONG C7).
func TestMovingAverage(t *testing.T) {
	def := decimal.NewFromInt(999)
	// Ví dụ trong spec: mua 100 @10, bán hết, mua 1 @100, bán 1 ⇒ giá vốn 100.
	got := movingAverage([]costEvent{ev(0, "purchase", "100", "1000"), ev(1, "sale", "100", "0"), ev(0, "purchase", "1", "100"), ev(2, "sale", "1", "0")}, def)
	wantUnit(t, got, 1, "10", false)
	wantUnit(t, got, 2, "100", false)

	// Nhiều bước: 10 @100 + 10 @130 ⇒ 115; bán 5; mua 5 @145 ⇒ (1.725 + 725) / 20 = 122,5.
	got = movingAverage([]costEvent{ev(0, "opening", "10", "1000"), ev(0, "purchase", "10", "1300"), ev(1, "sale", "5", "0"),
		ev(0, "purchase", "5", "725"), ev(2, "sale", "20", "0")}, def)
	wantUnit(t, got, 1, "115", false)
	wantUnit(t, got, 2, "122.5", false)

	// Trả NCC theo giá của chính phiếu trả: 10 @100 + 10 @200 (3.000) − 5 @200 (1.000) ⇒ 2.000 / 15.
	got = movingAverage([]costEvent{ev(0, "purchase", "10", "1000"), ev(0, "purchase", "10", "2000"), ev(0, "purchase_return", "5", "1000"),
		ev(1, "sale", "3", "0")}, def)
	wantUnit(t, got, 1, "133.333333", false)

	// Khách trả hàng nhập lại theo bình quân hiện tại, rồi trả NCC: 10 @100; bán 4; mua 6 @160 ⇒ 1.560 / 12 = 130;
	// khách trả 2 @130 ⇒ 1.820 / 14; trả NCC 4 thành tiền 700 ⇒ 1.120 / 10 = 112.
	got = movingAverage([]costEvent{ev(0, "purchase", "10", "1000"), ev(1, "sale", "4", "0"), ev(0, "purchase", "6", "960"),
		ev(2, "sale_return", "2", "0"), ev(0, "purchase_return", "4", "700"), ev(3, "sale", "5", "0")}, def)
	wantUnit(t, got, 1, "100", false)
	wantUnit(t, got, 2, "130", false)
	wantUnit(t, got, 3, "112", false)

	// Bán vào âm rồi mua: chưa có nhập ⇒ giá mặc định, ước tính; sau đó mua khi tồn ≤ 0 ⇒ bình quân = giá nhập mới.
	got = movingAverage([]costEvent{ev(1, "sale", "5", "0"), ev(0, "purchase", "10", "500"), ev(2, "sale", "5", "0")}, def)
	wantUnit(t, got, 1, "999", true)
	wantUnit(t, got, 2, "50", false)
	// Đã có nhập, bán vượt tồn (âm 3) ⇒ vẫn giá bình quân cũ; mua tiếp khi tồn âm ⇒ bình quân = đơn giá mới.
	got = movingAverage([]costEvent{ev(0, "purchase", "2", "20"), ev(1, "sale", "5", "0"), ev(0, "purchase", "10", "400"), ev(2, "sale", "1", "0")}, def)
	wantUnit(t, got, 1, "10", false)
	wantUnit(t, got, 2, "40", false)

	// Giá trị tồn không xuống dưới 0: 10 @10 (100), trả NCC 5 thành tiền 500 ⇒ giá trị 0 ⇒ bình quân 0.
	got = movingAverage([]costEvent{ev(0, "purchase", "10", "100"), ev(0, "purchase_return", "5", "500"), ev(1, "sale", "5", "0"),
		ev(0, "purchase", "5", "300"), ev(2, "sale", "5", "0")}, def)
	wantUnit(t, got, 1, "0", false)
	wantUnit(t, got, 2, "60", false)

	// Khách trả hàng trước mọi lần nhập ⇒ ước tính theo giá mặc định, và bán sau đó vẫn ước tính.
	got = movingAverage([]costEvent{ev(1, "sale_return", "4", "0"), ev(2, "sale", "2", "0")}, def)
	wantUnit(t, got, 1, "999", true)
	wantUnit(t, got, 2, "999", true)
}
