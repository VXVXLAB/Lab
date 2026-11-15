package tests

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"testing"

	"github.com/shopspring/decimal"
)

// QA vòng 5 (M-19 id lặp, M-20 tráo id giữa hai mặt hàng) — kiểm tra tính chất với thân PUT ngẫu nhiên dựng từ phiếu có
// dòng đặc biệt (hệ số ≠ 1, thuế suất): xáo trộn, lặp id, tráo id, id của phiếu khác, bỏ khóa, khóa tường minh, bỏ / thêm
// dòng. Bất biến:
//
//	(I1) 400 ⇒ phiếu không đổi một byte (cả version);
//	(I2) 200 ⇒ mỗi dòng kết quả i (ứng với dòng gửi thứ i): id là id cũ ⇒ cùng mặt hàng với dòng cũ đó, và mỗi trường
//	     đặc biệt (đơn vị / hệ số, thuế suất) = giá trị gửi nếu có khóa, = giá trị cũ nếu không có khóa; id mới ⇒ không
//	     có khóa thì là mặc định (hệ số 1, không thuế) — không thừa hưởng gì;
//	(I3) 200 ⇒ dòng đặc biệt cũ không còn (id không có trong kết quả) thì mọi dòng MỚI cùng mặt hàng phải có khóa tương
//	     ứng (vat_rate nếu dòng cũ có thuế; unit nếu dòng cũ có hệ số ≠ 1).
//
// Tức là: mọi dữ liệu đặc biệt đã lưu chỉ đổi khi body có khóa tường minh.
func TestMR_QA_QuyTacIDDong_NgauNhien(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mrEnable(e, "unit_conversion", "vat")
	k := e.Partner("K", "Khách", true, false)
	p := e.Product("P", "Nước", "Lon", 1000, 10, 0)
	q := e.Product("Q", "Cốc", "Cái", 500, 10, 0)
	r := e.Product("R", "Đĩa", "Cái", 700, 10, 0)
	e.setUnits(p, "Thùng", 24)
	e.setUnits(q, "Hộp", 6)
	e.Opening("2026-01-01", e.WH["KHO1"], UL(p, "Thùng", "1000", nil), Line(q, "100000", "10"), Line(r, "100000", "10"))
	prods := []int64{p, q, r}
	units := map[int64][]string{p: {"Lon", "Thùng"}, q: {"Cái", "Hộp"}, r: {"Cái"}}
	vats := []any{nil, 0, 5, 8, 10}
	rng := rand.New(rand.NewSource(20261115))
	foreign := e.Admin.CreateDoc(DocBody("sale", "2026-01-03", k, e.WH["KHO1"], UL(p, "Thùng", "1", 30000, "vat_rate", 10), Line(q, "1", "600")))
	randLine := func() map[string]any {
		pid := prods[rng.Intn(3)]
		us := units[pid]
		return UL(pid, us[rng.Intn(len(us))], fmt.Sprint(1+rng.Intn(3)), 30000, "vat_rate", vats[rng.Intn(len(vats))])
	}
	type stored struct {
		id      int64
		product int64
		unit    string
		factor  decimal.Decimal
		vat     *decimal.Decimal
	}
	readDoc := func(id int64) ([]stored, string) {
		var raw json.RawMessage
		e.Admin.OK("GET", fmt.Sprintf("/api/documents/%d", id), nil, &raw)
		x := e.Admin.GetDoc(id)
		var out []stored
		for _, l := range x.Lines {
			st := stored{id: l.ID, product: l.ProductID, unit: l.Unit, factor: decimal.NewFromInt(1)}
			if l.LineUnit != nil {
				st.factor = l.Factor
			}
			if l.LineVAT != nil {
				st.vat = l.VatRate
			}
			out = append(out, st)
		}
		return out, string(raw)
	}
	isSpecial := func(s stored) bool { return !s.factor.Equal(decimal.NewFromInt(1)) || s.vat != nil }
	vatEq := func(a, b *decimal.Decimal) bool { return (a == nil) == (b == nil) && (a == nil || a.Equal(*b)) }
	cases, accepted, refused := 300, 0, 0
	if testing.Short() {
		cases = 60
	}
	for c := 0; c < cases; c++ {
		var ls []map[string]any
		for i := 0; i < 2+rng.Intn(3); i++ {
			ls = append(ls, randLine())
		}
		d := e.Admin.CreateDoc(DocBody("sale", "2026-01-05", k, e.WH["KHO1"], ls...))
		if rng.Intn(3) == 0 {
			d = e.Admin.PostDoc(d)
		}
		old, oldRaw := readDoc(d.ID)
		// Thân ngẫu nhiên dựng từ các dòng đang lưu.
		var body []map[string]any
		for _, s := range old {
			if rng.Intn(6) == 0 {
				continue // bỏ dòng
			}
			m := map[string]any{"product_id": s.product, "qty": 1 + rng.Intn(3), "unit_price": 30000}
			switch rng.Intn(6) {
			case 0, 1:
				m["id"] = s.id
			case 2:
				m["id"] = old[rng.Intn(len(old))].id // có thể lặp / tráo id
			case 3:
				m["id"] = foreign.Lines[rng.Intn(len(foreign.Lines))].ID // id phiếu khác
			}
			switch rng.Intn(3) {
			case 0:
				m["unit"] = s.unit
			case 1:
				us := units[s.product]
				m["unit"] = us[rng.Intn(len(us))]
			}
			switch rng.Intn(3) {
			case 0:
				if s.vat != nil {
					m["vat_rate"] = s.vat
				} else {
					m["vat_rate"] = nil
				}
			case 1:
				m["vat_rate"] = vats[rng.Intn(len(vats))]
			}
			body = append(body, m)
		}
		if rng.Intn(4) == 0 {
			body = append(body, randLine())
		}
		rng.Shuffle(len(body), func(i, j int) { body[i], body[j] = body[j], body[i] })
		if len(body) == 0 {
			body = append(body, randLine())
		}
		var anyLines []any
		for _, m := range body {
			anyLines = append(anyLines, m)
		}
		res := e.Admin.Do("PUT", fmt.Sprintf("/api/documents/%d", d.ID), map[string]any{"version": d.Version, "doc_date": "2026-01-05",
			"partner_id": k, "warehouse_id": e.WH["KHO1"], "note": fmt.Sprint("ca ", c), "lines": anyLines, "confirm_loss": true})
		bj, _ := json.Marshal(body)
		switch {
		case res.Status == 400:
			if res.ErrCode() != "LINE_IDS_REQUIRED" {
				t.Fatalf("ca %d: 400 khác: %s\nbody %s", c, res.Body, bj)
			}
			refused++
			if _, now := readDoc(d.ID); now != oldRaw {
				t.Fatalf("ca %d (I1): 400 mà phiếu đổi\nbody %s", c, bj)
			}
			continue
		case res.Status != 200:
			t.Fatalf("ca %d: %d %s\nbody %s", c, res.Status, res.Body, bj)
		}
		accepted++
		got, _ := readDoc(d.ID)
		byID := map[int64]stored{}
		for _, s := range old {
			byID[s.id] = s
		}
		inResult := map[int64]bool{}
		for i, g := range got {
			b := body[i]
			_, hasUnit := b["unit"]
			_, hasVat := b["vat_rate"]
			if s, ok := byID[g.id]; ok {
				inResult[g.id] = true
				if s.product != g.product {
					t.Fatalf("ca %d (I2): dòng giữ id %d nhưng đổi mặt hàng\nbody %s", c, g.id, bj)
				}
				if !hasUnit && (!g.factor.Equal(s.factor) || !strings.EqualFold(g.unit, s.unit)) {
					t.Fatalf("ca %d (I2): không gửi unit mà đơn vị đổi %s×%s → %s×%s\nbody %s", c, s.unit, s.factor, g.unit, g.factor, bj)
				}
				if !hasVat && !vatEq(g.vat, s.vat) {
					t.Fatalf("ca %d (I2): không gửi vat_rate mà thuế đổi %v → %v\nbody %s", c, s.vat, g.vat, bj)
				}
			} else {
				if !hasUnit && !g.factor.Equal(decimal.NewFromInt(1)) {
					t.Fatalf("ca %d (I2): dòng mới thừa hưởng hệ số %s\nbody %s", c, g.factor, bj)
				}
				if !hasVat && g.vat != nil {
					t.Fatalf("ca %d (I2): dòng mới thừa hưởng thuế %v\nbody %s", c, g.vat, bj)
				}
			}
			if hasVat {
				var want *decimal.Decimal
				switch v := b["vat_rate"].(type) {
				case *decimal.Decimal:
					want = v
				case int:
					x := decimal.NewFromInt(int64(v))
					want = &x
				}
				if !vatEq(g.vat, want) {
					t.Fatalf("ca %d (I2): gửi vat_rate %v nhận %v\nbody %s", c, b["vat_rate"], g.vat, bj)
				}
			}
		}
		for _, s := range old {
			if inResult[s.id] || !isSpecial(s) {
				continue
			}
			for i, g := range got {
				if _, isOld := byID[g.id]; isOld || g.product != s.product {
					continue
				}
				_, hasUnit := body[i]["unit"]
				_, hasVat := body[i]["vat_rate"]
				if (s.vat != nil && !hasVat) || (!s.factor.Equal(decimal.NewFromInt(1)) && !hasUnit) {
					t.Fatalf("ca %d (I3): dòng đặc biệt %d bị bỏ, dòng mới cùng mặt hàng thiếu khóa\nbody %s", c, s.id, bj)
				}
			}
		}
	}
	if accepted < cases/5 || refused < cases/10 {
		t.Fatalf("phân bố ca không đủ: nhận %d, từ chối %d", accepted, refused)
	}
	t.Logf("%d ca: nhận %d, từ chối %d", cases, accepted, refused)
}
