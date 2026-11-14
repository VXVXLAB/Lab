package httpapi

import (
	"net/http"
	"strings"

	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/export"
	"kho/internal/reports"
	"kho/internal/util"
)

// respond trả JSON, hoặc file nếu format=xlsx|docx.
func (s *Server) respond(w http.ResponseWriter, r *http.Request, data any, name string, table func() export.Table) {
	switch f := r.URL.Query().Get("format"); f {
	case "", "json":
		writeJSON(w, http.StatusOK, data)
	case "xlsx", "docx":
		if err := s.sendFile(w, r, f, name, table()); err != nil {
			writeErr(w, r, err)
		}
	default:
		writeErr(w, r, apperr.ValidationField("format", "format phải là json, xlsx hoặc docx"))
	}
}

func (s *Server) warehouseLabel(r *http.Request, id *int64) string {
	if id == nil {
		return "Tất cả kho"
	}
	wh, err := s.Catalog.GetWarehouse(r.Context(), s.Pool, *id)
	if err != nil {
		return "Kho ?"
	}
	return wh.Name
}

func (s *Server) reportStockSummary(w http.ResponseWriter, r *http.Request) {
	asOf, e1 := qDate(r, "as_of")
	g, e2 := qInt64(r, "group_id")
	wh, e3 := qInt64(r, "warehouse_id")
	only, e4 := qBool(r, "only_with_data")
	if err := firstErr(e1, e2, e3, e4); err != nil {
		writeErr(w, r, err)
		return
	}
	p := reports.StockSummaryParams{GroupID: g, WarehouseID: wh, Q: strings.TrimSpace(r.URL.Query().Get("q")), OnlyWithData: true}
	if asOf != nil {
		p.AsOf = *asOf
	}
	if only != nil {
		p.OnlyWithData = *only
	}
	out, err := s.Reports.StockSummary(r.Context(), p)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "BaoCaoTonKho_"+out.AsOf.String(), func() export.Table { return export.StockSummaryTable(out) })
}

func (s *Server) reportStockNXT(w http.ResponseWriter, r *http.Request) {
	from, e1 := qDate(r, "from")
	to, e2 := qDate(r, "to")
	wh, e3 := qInt64(r, "warehouse_id")
	g, e4 := qInt64(r, "group_id")
	if err := firstErr(e1, e2, e3, e4); err != nil {
		writeErr(w, r, err)
		return
	}
	f, t := reports.DefaultRange(from, to)
	out, err := s.Reports.StockNXT(r.Context(), reports.NXTParams{From: f, To: t, WarehouseID: wh, GroupID: g, Q: strings.TrimSpace(r.URL.Query().Get("q"))})
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "NhapXuatTon_"+f.String()+"_"+t.String(), func() export.Table { return export.NXTTable(out, s.warehouseLabel(r, wh)) })
}

func (s *Server) reportStockLedger(w http.ResponseWriter, r *http.Request) {
	pid, e1 := qInt64(r, "product_id")
	from, e2 := qDate(r, "from")
	to, e3 := qDate(r, "to")
	wh, e4 := qInt64(r, "warehouse_id")
	if err := firstErr(e1, e2, e3, e4); err != nil {
		writeErr(w, r, err)
		return
	}
	if pid == nil {
		writeErr(w, r, apperr.ValidationField("product_id", "Vui lòng chọn mặt hàng"))
		return
	}
	out, err := s.Reports.StockLedger(r.Context(), reports.LedgerParams{ProductID: *pid, From: from, To: to, WarehouseID: wh})
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "TheKho_"+out.Product.Code, func() export.Table { return export.LedgerTable(out, s.warehouseLabel(r, wh)) })
}

func (s *Server) reportTrade(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		from, e1 := qDate(r, "from")
		to, e2 := qDate(r, "to")
		pa, e3 := qInt64(r, "partner_id")
		pr, e4 := qInt64(r, "product_id")
		g, e5 := qInt64(r, "group_id")
		wh, e6 := qInt64(r, "warehouse_id")
		inc, e7 := qBool(r, "include_returns")
		if err := firstErr(e1, e2, e3, e4, e5, e6, e7); err != nil {
			writeErr(w, r, err)
			return
		}
		f, t := reports.DefaultRange(from, to)
		p := reports.TradeParams{From: f, To: t, PartnerID: pa, ProductID: pr, GroupID: g, WarehouseID: wh, Q: strings.TrimSpace(r.URL.Query().Get("q"))}
		if inc != nil {
			p.IncludeReturns = *inc
		}
		out, err := s.Reports.TradeReport(r.Context(), kind, p)
		if err != nil {
			writeErr(w, r, err)
			return
		}
		name := "BaoCaoBanHang_"
		if kind == "purchases" {
			name = "BaoCaoMuaHang_"
		}
		s.respond(w, r, out, name+f.String()+"_"+t.String(), func() export.Table { return export.TradeTable(out) })
	}
}

func (s *Server) debtParams(r *http.Request) (reports.DebtParams, error) {
	from, e1 := qDate(r, "from")
	to, e2 := qDate(r, "to")
	pid, e3 := qInt64(r, "partner_id")
	iz, e4 := qBool(r, "include_zero")
	if err := firstErr(e1, e2, e3, e4); err != nil {
		return reports.DebtParams{}, err
	}
	p := reports.DebtParams{Side: r.URL.Query().Get("side"), From: from, To: to, Q: strings.TrimSpace(r.URL.Query().Get("q"))}
	if p.Side == "" {
		p.Side = "receivable"
	}
	if pid != nil {
		p.PartnerID = *pid
	}
	if iz != nil {
		p.IncludeZero = *iz
	}
	return p, nil
}

func (s *Server) reportDebtSummary(w http.ResponseWriter, r *http.Request) {
	p, err := s.debtParams(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	out, err := s.Reports.DebtSummary(r.Context(), p)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	name := "CongNoPhaiThu"
	if p.Side == "payable" {
		name = "CongNoPhaiTra"
	}
	s.respond(w, r, out, name, func() export.Table { return export.DebtSummaryTable(out) })
}

func (s *Server) reportDebtLedger(w http.ResponseWriter, r *http.Request) {
	p, err := s.debtParams(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	out, err := s.Reports.DebtLedger(r.Context(), p)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "SoCongNo_"+out.Partner.Code, func() export.Table { return export.DebtLedgerTable(out) })
}

func (s *Server) reportCashBook(w http.ResponseWriter, r *http.Request) {
	acc, e1 := qInt64(r, "account_id")
	from, e2 := qDate(r, "from")
	to, e3 := qDate(r, "to")
	if err := firstErr(e1, e2, e3); err != nil {
		writeErr(w, r, err)
		return
	}
	out, err := s.Reports.CashBook(r.Context(), reports.CashBookParams{AccountID: acc, Kind: r.URL.Query().Get("kind"), From: from, To: to})
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "SoQuy", func() export.Table { return export.CashBookTable(out) })
}

func (s *Server) reportDraftDemand(w http.ResponseWriter, r *http.Request) {
	only, err := qBool(r, "only_shortage")
	if err != nil {
		writeErr(w, r, err)
		return
	}
	out, err := s.Reports.DraftDemand(r.Context(), only != nil && *only)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, map[string]any{"items": out}, "HangCanDat_"+util.Today().String(), func() export.Table { return export.DemandTable(out) })
}

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	th := decimal.NewFromInt(5)
	if v := strings.TrimSpace(r.URL.Query().Get("low_stock_threshold")); v != "" {
		d, err := decimal.NewFromString(v)
		if err != nil || d.IsNegative() {
			writeErr(w, r, apperr.ValidationField("low_stock_threshold", "Ngưỡng sắp hết phải là số ≥ 0"))
			return
		}
		th = d
	}
	out, err := s.Reports.Dashboard(r.Context(), th)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
