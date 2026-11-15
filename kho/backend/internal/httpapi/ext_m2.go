package httpapi

// Endpoint bản mở rộng đợt M2: giá theo khách (C6), hàng dưới tồn tối thiểu (C5), tuổi nợ (C8), lãi gộp (C7).

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"kho/internal/apperr"
	"kho/internal/export"
	"kho/internal/ext"
	"kho/internal/pricing"
	"kho/internal/reports"
	"kho/internal/util"
)

// ---------- C6 giá theo khách ----------

func (s *Server) listPartnerPrices(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPriceList); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if err := pricing.CheckPartner(r.Context(), s.Pool, id); err != nil {
		writeErr(w, r, err)
		return
	}
	items, err := pricing.List(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"partner_id": id, "items": items})
}

func (s *Server) savePartnerPrices(w http.ResponseWriter, r *http.Request) {
	if err := firstErr(featureOn(r, ext.FPriceList), need(r, ext.PSaleWrite)); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var in struct {
		Items   []pricing.Item `json:"items"`
		Replace bool           `json:"replace"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	items, err := pricing.Save(r.Context(), s.Pool, userOf(r).ID, id, in.Items, in.Replace)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishCatalog(r, "partner_prices", id, "updated")
	writeJSON(w, http.StatusOK, map[string]any{"partner_id": id, "items": items})
}

func (s *Server) deletePartnerPrice(w http.ResponseWriter, r *http.Request) {
	if err := firstErr(featureOn(r, ext.FPriceList), need(r, ext.PSaleWrite)); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	pid, err := strconv.ParseInt(chi.URLParam(r, "product_id"), 10, 64)
	if err != nil || pid <= 0 {
		writeErr(w, r, apperr.NotFound("mặt hàng"))
		return
	}
	if err := pricing.Delete(r.Context(), s.Pool, userOf(r).ID, id, pid); err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishCatalog(r, "partner_prices", id, "deleted")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// salePrice: GET /products/sale-price?partner_id=&ids=1,2&date= — giá tự điền và nguồn giá.
func (s *Server) salePrice(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPriceList); err != nil {
		writeErr(w, r, err)
		return
	}
	pid, e1 := qInt64(r, "partner_id")
	date, e2 := qDate(r, "date")
	if err := firstErr(e1, e2); err != nil {
		writeErr(w, r, err)
		return
	}
	if pid == nil {
		writeErr(w, r, apperr.ValidationField("partner_id", "Vui lòng chọn khách hàng"))
		return
	}
	if err := pricing.CheckPartner(r.Context(), s.Pool, *pid); err != nil {
		writeErr(w, r, err)
		return
	}
	var ids []int64
	for _, part := range strings.Split(r.URL.Query().Get("ids"), ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		v, err := strconv.ParseInt(part, 10, 64)
		if err != nil || v <= 0 {
			writeErr(w, r, apperr.ValidationField("ids", "ids chỉ gồm các số nguyên dương cách nhau dấu phẩy"))
			return
		}
		ids = append(ids, v)
	}
	if len(ids) == 0 {
		writeErr(w, r, apperr.ValidationField("ids", "Vui lòng truyền ids (mã số mặt hàng)"))
		return
	}
	if len(ids) > maxPriceInfoIDs {
		writeErr(w, r, apperr.ValidationField("ids", "Tối đa 500 mặt hàng mỗi lần"))
		return
	}
	d := util.Today()
	if date != nil {
		d = *date
	}
	qs, err := pricing.Resolve(r.Context(), s.Pool, *pid, ids, d)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"partner_id": *pid, "date": d, "items": qs})
}

// ---------- C5 / C8 / C7 báo cáo ----------

func (s *Server) reportLowStock(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FMinStock); err != nil {
		writeErr(w, r, err)
		return
	}
	out, err := s.Reports.LowStock(r.Context())
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, map[string]any{"items": out}, "DuoiTonToiThieu_"+util.Today().String(), func() export.Table { return export.LowStockTable(out) })
}

func (s *Server) reportDebtAging(w http.ResponseWriter, r *http.Request) {
	if err := firstErr(featureOn(r, ext.FCreditLimit), need(r, ext.PDebtView)); err != nil {
		writeErr(w, r, err)
		return
	}
	asOf, e1 := qDate(r, "as_of")
	pid, e2 := qInt64(r, "partner_id")
	if err := firstErr(e1, e2); err != nil {
		writeErr(w, r, err)
		return
	}
	p := reports.AgingParams{PartnerID: pid, Q: strings.TrimSpace(r.URL.Query().Get("q"))}
	if asOf != nil {
		p.AsOf = *asOf
	}
	out, err := s.Reports.DebtAging(r.Context(), p)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "TuoiNo_"+out.AsOf.String(), func() export.Table { return export.AgingTable(out) })
}

func (s *Server) reportProfit(w http.ResponseWriter, r *http.Request) {
	if err := firstErr(featureOn(r, ext.FProfitReport), need(r, ext.PReportView, ext.PCostView)); err != nil {
		writeErr(w, r, err)
		return
	}
	from, e1 := qDate(r, "from")
	to, e2 := qDate(r, "to")
	pa, e3 := qInt64(r, "partner_id")
	pr, e4 := qInt64(r, "product_id")
	if err := firstErr(e1, e2, e3, e4); err != nil {
		writeErr(w, r, err)
		return
	}
	f, t := reports.DefaultRange(from, to)
	out, err := s.Reports.ProfitReport(r.Context(), reports.ProfitParams{From: f, To: t, GroupBy: r.URL.Query().Get("group_by"), PartnerID: pa, ProductID: pr})
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "LaiGop_"+out.GroupBy+"_"+f.String()+"_"+t.String(), func() export.Table { return export.ProfitTable(out) })
}
