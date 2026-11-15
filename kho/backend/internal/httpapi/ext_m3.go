package httpapi

import (
	"io"
	"net/http"
	"strings"

	"kho/internal/apperr"
	"kho/internal/catalog"
	"kho/internal/export"
	"kho/internal/ext"
	"kho/internal/printtpl"
	"kho/internal/reports"
	"kho/internal/util"
	"kho/internal/vat"
)

// Bản mở rộng đợt M3: C9 kiểm kê, C10 quy đổi đơn vị, C11 thuế GTGT, C12 mẫu in.

// ---------- C10 đơn vị quy đổi ----------

func (s *Server) listProductUnits(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FUnitConversion); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	p, err := s.Catalog.GetProduct(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	us, err := catalog.ListUnits(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"product_id": id, "base_unit": p.Unit, "items": us})
}

func (s *Server) saveProductUnits(w http.ResponseWriter, r *http.Request) {
	if err := firstErr(featureOn(r, ext.FUnitConversion), need(r, ext.PCatalogWrite)); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var in struct {
		Items []catalog.UnitInput `json:"items"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	us, err := s.Catalog.SaveUnits(r.Context(), userOf(r).ID, id, in.Items)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	p, err := s.Catalog.GetProduct(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishCatalog(r, "product", id, "updated")
	writeJSON(w, http.StatusOK, map[string]any{"product_id": id, "base_unit": p.Unit, "items": us})
}

// ---------- C9 kiểm kê ----------

// stocktakeLoad: GET /documents/stocktake-load?warehouse_id=&date= — mọi mã có tồn ≠ 0 tại kho cuối ngày (nạp phiếu).
func (s *Server) stocktakeLoad(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FStocktake); err != nil {
		writeErr(w, r, err)
		return
	}
	wh, e1 := qInt64(r, "warehouse_id")
	date, e2 := qDate(r, "date")
	if err := firstErr(e1, e2); err != nil {
		writeErr(w, r, err)
		return
	}
	if wh == nil {
		writeErr(w, r, apperr.ValidationField("warehouse_id", "Vui lòng chọn kho"))
		return
	}
	d := util.Today()
	if date != nil {
		d = *date
	}
	items, err := s.Docs.StocktakeLoad(r.Context(), *wh, d)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"warehouse_id": *wh, "date": d, "items": items})
}

// ---------- C11 thuế GTGT ----------

func (s *Server) getVatSettings(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FVAT); err != nil {
		writeErr(w, r, err)
		return
	}
	c, err := vat.DefaultCode(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, vatSettingsOut(c))
}

func vatSettingsOut(c string) map[string]any {
	var v any
	if c != "" {
		v = c
	}
	return map[string]any{"default_vat_rate": v, "codes": vat.Codes}
}

func (s *Server) putVatSettings(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FVAT); err != nil {
		writeErr(w, r, err)
		return
	}
	var in struct {
		Default util.OptStr `json:"default_vat_rate"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if !in.Default.Set {
		writeErr(w, r, apperr.ValidationField("default_vat_rate", "Thiếu default_vat_rate (null = không thuế)"))
		return
	}
	if err := vat.CheckCode("default_vat_rate", in.Default.Val); err != nil {
		writeErr(w, r, err)
		return
	}
	before, err := vat.DefaultCode(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	tx, err := s.Pool.Begin(r.Context())
	if err != nil {
		writeErr(w, r, err)
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck
	if _, err := tx.Exec(r.Context(), `UPDATE settings SET default_vat=$1, updated_by=$2, updated_at=now() WHERE id=1`, in.Default.Val, userOf(r).ID); err != nil {
		writeErr(w, r, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO audit_log(user_id,entity,entity_id,action,before,after) VALUES ($1,'vat_settings',1,'updated',$2,$3)`,
		userOf(r).ID, map[string]any{"default_vat_rate": before}, map[string]any{"default_vat_rate": in.Default.Val}); err != nil {
		writeErr(w, r, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, r, err)
		return
	}
	c := ""
	if in.Default.Val != nil {
		c = *in.Default.Val
	}
	s.publish(r, eventFeatures())
	writeJSON(w, http.StatusOK, vatSettingsOut(c))
}

// reportVat: GET /reports/vat-summary?from=&to=[&format=xlsx|docx] — bảng kê thuế theo thuế suất; phần mua vào cần
// cost.view (không có ⇒ purchases = null).
func (s *Server) reportVat(w http.ResponseWriter, r *http.Request) {
	if err := firstErr(featureOn(r, ext.FVAT), need(r, ext.PReportView)); err != nil {
		writeErr(w, r, err)
		return
	}
	from, e1 := qDate(r, "from")
	to, e2 := qDate(r, "to")
	if err := firstErr(e1, e2); err != nil {
		writeErr(w, r, err)
		return
	}
	f, t := reports.DefaultRange(from, to)
	out, err := s.Reports.VatSummary(r.Context(), f, t, can(r, ext.PCostView))
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.respond(w, r, out, "BangKeThueGTGT_"+f.String()+"_"+t.String(), func() export.Table { return export.VatTable(out) })
}

// ---------- C12 mẫu in ----------

func (s *Server) getPrintTemplate(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPrintTemplate); err != nil {
		writeErr(w, r, err)
		return
	}
	info, err := printtpl.Load(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, printOut(info))
}

func printOut(info *printtpl.Info) map[string]any {
	return map[string]any{"template": info, "default_signatures": export.DefaultSignatures()}
}

func (s *Server) putPrintTemplate(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPrintTemplate); err != nil {
		writeErr(w, r, err)
		return
	}
	var in printtpl.Template
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	info, err := printtpl.Save(r.Context(), s.Pool, userOf(r).ID, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publish(r, eventFeatures())
	writeJSON(w, http.StatusOK, printOut(info))
}

func (s *Server) getLogo(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPrintTemplate); err != nil {
		writeErr(w, r, err)
		return
	}
	b, ct, err := printtpl.Logo(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

// putLogo: PUT /print-template/logo — multipart (trường "file") hoặc thân là ảnh PNG/JPG.
func (s *Server) putLogo(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPrintTemplate); err != nil {
		writeErr(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, printtpl.MaxLogo+64*1024)
	var data []byte
	var err error
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		f, _, ferr := r.FormFile("file")
		if ferr != nil {
			writeErr(w, r, apperr.ValidationField("file", "Không đọc được file logo (tối đa 500 KB, trường \"file\")"))
			return
		}
		defer f.Close()
		data, err = io.ReadAll(io.LimitReader(f, printtpl.MaxLogo+1))
	} else {
		data, err = io.ReadAll(r.Body)
	}
	if err != nil {
		writeErr(w, r, apperr.ValidationField("file", "Logo tối đa 500 KB"))
		return
	}
	info, err := printtpl.SaveLogo(r.Context(), s.Pool, userOf(r).ID, data)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publish(r, eventFeatures())
	writeJSON(w, http.StatusOK, printOut(info))
}

func (s *Server) deleteLogo(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPrintTemplate); err != nil {
		writeErr(w, r, err)
		return
	}
	if err := printtpl.DeleteLogo(r.Context(), s.Pool, userOf(r).ID); err != nil {
		writeErr(w, r, err)
		return
	}
	s.publish(r, eventFeatures())
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// printOpts trả mẫu in áp vào file xuất (nil khi tính năng tắt ⇒ y như bản chuẩn).
func (s *Server) printOpts(r *http.Request, key string) *export.PrintOpts {
	if !extOf(r).st.On(ext.FPrintTemplate) {
		return nil
	}
	info, err := printtpl.Load(r.Context(), s.Pool)
	if err != nil {
		return nil
	}
	o := &export.PrintOpts{Footer: info.Footer, HideUnit: info.HideUnitColumn, HideCode: info.HideCodeColumn}
	if sig, ok := info.Signatures[key]; ok {
		o.Signatures = sig
	}
	return o
}
