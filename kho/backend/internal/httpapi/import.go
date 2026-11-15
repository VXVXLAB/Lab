package httpapi

import (
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"kho/internal/apperr"
	"kho/internal/events"
	"kho/internal/ext"
	"kho/internal/importx"
	"kho/internal/util"
)

// importAccess: tính năng import_excel bật + quyền theo loại (danh mục: catalog.write; tồn đầu: stock.write;
// công nợ đầu kỳ: quản trị).
func importAccess(r *http.Request) (string, error) {
	if err := featureOn(r, ext.FImportExcel); err != nil {
		return "", err
	}
	kind := chi.URLParam(r, "kind")
	if !importx.ValidKind(kind) {
		return "", apperr.NotFound("loại nhập " + kind + " (products, partners, opening_stock, opening_debt)")
	}
	switch kind {
	case importx.KindProducts, importx.KindPartners:
		return kind, need(r, ext.PCatalogWrite)
	case importx.KindOpeningStock:
		return kind, need(r, ext.PStockWrite)
	default:
		if !userOf(r).IsAdmin() {
			return kind, apperr.Forbidden("Chỉ quản trị mới có quyền nhập công nợ đầu kỳ")
		}
	}
	return kind, nil
}

func (s *Server) importTemplate(w http.ResponseWriter, r *http.Request) {
	kind, err := importAccess(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	data, err := importx.Template(r.Context(), s.Pool, kind)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	name := "Mau_nhap_" + kind + ".xlsx"
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// importRun: POST /import/{kind}?dry_run=1&date=YYYY-MM-DD, multipart trường "file".
func (s *Server) importRun(w http.ResponseWriter, r *http.Request) {
	kind, err := importAccess(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	dry, e1 := qBool(r, "dry_run")
	date, e2 := qDate(r, "date")
	if err := firstErr(e1, e2); err != nil {
		writeErr(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, importx.MaxFileBytes+1<<20)
	if err := r.ParseMultipartForm(importx.MaxFileBytes + 1<<20); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeErr(w, r, apperr.ValidationField("file", "File quá lớn (tối đa 10 MB)"))
			return
		}
		writeErr(w, r, apperr.ValidationField("file", "Vui lòng gửi file Excel (multipart/form-data, trường \"file\")"))
		return
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		writeErr(w, r, apperr.ValidationField("file", "Vui lòng chọn file Excel"))
		return
	}
	defer f.Close()
	if hdr.Size > importx.MaxFileBytes {
		writeErr(w, r, apperr.ValidationField("file", "File quá lớn (tối đa 10 MB)"))
		return
	}
	data, err := io.ReadAll(io.LimitReader(f, importx.MaxFileBytes+1))
	if err != nil {
		writeErr(w, r, err)
		return
	}
	opt := importx.Options{DryRun: dry != nil && *dry, UserID: userOf(r).ID, CanCost: can(r, ext.PCostView)}
	if date != nil {
		opt.Date = *date
	} else {
		opt.Date = util.Today()
	}
	res, err := importx.Run(r.Context(), s.Pool, kind, data, opt)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if !opt.DryRun {
		switch kind {
		case importx.KindProducts:
			s.publishCatalog(r, "product", 0, "imported")
		case importx.KindPartners, importx.KindOpeningDebt:
			s.publishCatalog(r, "partner", 0, "imported")
		case importx.KindOpeningStock:
			for _, d := range res.Documents {
				s.publish(r, events.Event{Type: "document.changed", ID: d.ID, DocType: "opening", Status: "draft", Action: "created"})
			}
		}
	}
	writeJSON(w, http.StatusOK, res)
}
