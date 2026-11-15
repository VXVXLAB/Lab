package httpapi

import (
	"net/http"

	"github.com/shopspring/decimal"
	"strings"

	"kho/internal/apperr"
	"kho/internal/cash"
	"kho/internal/docs"
	"kho/internal/events"
	"kho/internal/export"
	"kho/internal/ext"
)

func (s *Server) publishDoc(r *http.Request, d *docs.Document, action string) {
	s.publish(r, events.Event{Type: "document.changed", ID: d.ID, DocType: d.DocType, Status: d.Status, Action: action})
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	p, err := listParams(r, 50, 500)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	f := docs.Filter{ListParams: p, Status: r.URL.Query().Get("status")}
	if t := strings.TrimSpace(r.URL.Query().Get("type")); t != "" {
		f.Type = strings.Split(t, ",")
	}
	var e1, e2, e3, e4, e5 error
	f.PartnerID, e1 = qInt64(r, "partner_id")
	f.WarehouseID, e2 = qInt64(r, "warehouse_id")
	f.ProductID, e3 = qInt64(r, "product_id")
	f.From, e4 = qDate(r, "from")
	f.To, e5 = qDate(r, "to")
	if err := firstErr(e1, e2, e3, e4, e5); err != nil {
		writeErr(w, r, err)
		return
	}
	out, err := s.Docs.List(r.Context(), f)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// docAccess kiểm tra quyền thao tác trên chứng từ đang có: quyền lập loại phiếu đó, và posted.edit nếu phiếu đã ghi sổ
// (khi postedNeedsEdit). Trả loại và trạng thái hiện tại.
func (s *Server) docAccess(r *http.Request, id int64, postedNeedsEdit bool) (string, string, error) {
	var typ, status string
	if err := s.Pool.QueryRow(r.Context(), `SELECT doc_type, status FROM documents WHERE id=$1`, id).Scan(&typ, &status); err != nil {
		return "", "", apperr.NotFound("chứng từ")
	}
	if err := need(r, docWritePerm(typ)); err != nil {
		return "", "", err
	}
	if postedNeedsEdit && status == docs.StatusPosted {
		if err := need(r, ext.PPostedEdit); err != nil {
			return "", "", err
		}
	}
	return typ, status, nil
}

func (s *Server) createDocument(w http.ResponseWriter, r *http.Request) {
	var in docs.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if err := need(r, docWritePerm(in.DocType)); err != nil {
		writeErr(w, r, err)
		return
	}
	d, err := s.Docs.Create(r.Context(), userOf(r).ID, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishDoc(r, d, "created")
	writeJSON(w, http.StatusCreated, d)
}

func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	d, err := s.Docs.Get(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) updateDocument(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var in docs.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	typ, _, err := s.docAccess(r, id, true)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if costDocTypes[typ] && !can(r, ext.PCostView) {
		// Người không xem được giá mua nhận đơn giá null: giữ đơn giá cũ cho dòng gửi lại id (không làm mất giá vốn).
		if err := s.keepHiddenPrices(r, id, &in); err != nil {
			writeErr(w, r, err)
			return
		}
	}
	d, err := s.Docs.Update(r.Context(), userOf(r).ID, id, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishDoc(r, d, "updated")
	writeJSON(w, http.StatusOK, d)
}

type versionBody struct {
	Version     int  `json:"version"`
	ConfirmLoss bool `json:"confirm_loss"`
}

func (s *Server) postDocument(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var in versionBody
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if _, _, err := s.docAccess(r, id, false); err != nil {
		writeErr(w, r, err)
		return
	}
	d, err := s.Docs.Post(r.Context(), userOf(r).ID, id, in.Version, in.ConfirmLoss)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishDoc(r, d, "posted")
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) unpostDocument(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var in versionBody
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if _, _, err := s.docAccess(r, id, true); err != nil {
		writeErr(w, r, err)
		return
	}
	d, err := s.Docs.Unpost(r.Context(), userOf(r).ID, id, in.Version)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishDoc(r, d, "unposted")
	writeJSON(w, http.StatusOK, d)
}

func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	v, err := qInt(r, "version", 0)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if _, _, err := s.docAccess(r, id, true); err != nil {
		writeErr(w, r, err)
		return
	}
	d, err := s.Docs.Delete(r.Context(), userOf(r).ID, id, v)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishDoc(r, d, "deleted")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func (s *Server) checkDocument(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	res, err := s.Docs.Check(r.Context(), id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// checkDocumentInput: POST /documents/check — kiểm tra phiếu chưa lưu (body như POST/PUT, thêm "id" nếu đang sửa).
func (s *Server) checkDocumentInput(w http.ResponseWriter, r *http.Request) {
	var in struct {
		docs.Input
		ID int64 `json:"id"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if in.ID < 0 {
		writeErr(w, r, apperr.ValidationField("id", "id không hợp lệ"))
		return
	}
	typ := in.DocType
	if in.ID > 0 {
		var err error
		if typ, _, err = s.docAccess(r, in.ID, false); err != nil {
			writeErr(w, r, err)
			return
		}
	} else if err := need(r, docWritePerm(typ)); err != nil {
		writeErr(w, r, err)
		return
	}
	res, err := s.Docs.CheckInput(r.Context(), in.Input, in.ID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) exportDocument(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "xlsx"
	}
	if format != "xlsx" && format != "docx" {
		writeErr(w, r, apperr.ValidationField("format", "format phải là xlsx hoặc docx"))
		return
	}
	d, err := s.Docs.Get(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	name := d.DisplayNo
	if d.Status != docs.StatusPosted {
		name = "PHIEU_TAM_" + d.DraftNo
	}
	if err := s.sendFile(w, r, format, name, export.DocumentTableMasked(d, !can(r, ext.PCostView), !can(r, ext.PDebtView))); err != nil {
		writeErr(w, r, err)
	}
}

func (s *Server) documentHistory(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if _, err := s.Docs.Get(r.Context(), s.Pool, id); err != nil {
		// Phiếu đã xóa vẫn xem được lịch sử.
		if ae := apperr.From(err); ae.Code != apperr.CodeNotFound {
			writeErr(w, r, err)
			return
		}
	}
	h, err := docs.History(r.Context(), s.Pool, "document", id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": h})
}

// ---------- Thu chi ----------

func (s *Server) publishVoucher(r *http.Request, v *cash.Voucher, action string) {
	s.publish(r, events.Event{Type: "voucher.changed", ID: v.ID, DocType: v.VoucherType, Action: action})
}

// voucherRead: xem phiếu thu chi cần quyền xem sổ quỹ hoặc quyền lập phiếu thu chi.
func voucherRead(r *http.Request) error {
	if can(r, ext.PCashView) || can(r, ext.PCashWrite) {
		return nil
	}
	return need(r, ext.PCashView)
}

func (s *Server) listVouchers(w http.ResponseWriter, r *http.Request) {
	if err := voucherRead(r); err != nil {
		writeErr(w, r, err)
		return
	}
	p, err := listParams(r, 50, 500)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	f := cash.Filter{ListParams: p, Type: r.URL.Query().Get("type")}
	var e1, e2, e3, e4 error
	f.AccountID, e1 = qInt64(r, "account_id")
	f.PartnerID, e2 = qInt64(r, "partner_id")
	f.From, e3 = qDate(r, "from")
	f.To, e4 = qDate(r, "to")
	if err := firstErr(e1, e2, e3, e4); err != nil {
		writeErr(w, r, err)
		return
	}
	out, err := s.Cash.List(r.Context(), f)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) createVoucher(w http.ResponseWriter, r *http.Request) {
	if err := need(r, ext.PCashWrite); err != nil {
		writeErr(w, r, err)
		return
	}
	var in cash.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	v, err := s.Cash.Create(r.Context(), userOf(r).ID, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishVoucher(r, v, "created")
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) getVoucher(w http.ResponseWriter, r *http.Request) {
	if err := voucherRead(r); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	v, err := s.Cash.Get(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) updateVoucher(w http.ResponseWriter, r *http.Request) {
	if err := need(r, ext.PCashWrite); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var in cash.Input
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	v, err := s.Cash.Update(r.Context(), userOf(r).ID, id, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishVoucher(r, v, "updated")
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) deleteVoucher(w http.ResponseWriter, r *http.Request) {
	if err := need(r, ext.PCashWrite); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	ver, err := qInt(r, "version", 0)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	v, err := s.Cash.Delete(r.Context(), userOf(r).ID, id, ver)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishVoucher(r, v, "deleted")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

func (s *Server) exportVoucher(w http.ResponseWriter, r *http.Request) {
	if err := voucherRead(r); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "xlsx"
	}
	if format != "xlsx" && format != "docx" {
		writeErr(w, r, apperr.ValidationField("format", "format phải là xlsx hoặc docx"))
		return
	}
	v, err := s.Cash.Get(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if err := s.sendFile(w, r, format, v.VoucherNo, export.VoucherTable(v)); err != nil {
		writeErr(w, r, err)
	}
}

func (s *Server) voucherHistory(w http.ResponseWriter, r *http.Request) {
	if err := voucherRead(r); err != nil {
		writeErr(w, r, err)
		return
	}
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	h, err := docs.History(r.Context(), s.Pool, "voucher", id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": h})
}

// keepHiddenPrices: dòng gửi lại id của chính phiếu mà đơn giá null (người sửa không thấy giá) ⇒ dùng lại đơn giá cũ.
func (s *Server) keepHiddenPrices(r *http.Request, id int64, in *docs.Input) error {
	old, err := s.Docs.Get(r.Context(), s.Pool, id)
	if err != nil {
		return err
	}
	prices := map[int64]*decimal.Decimal{}
	for _, l := range old.Lines {
		prices[l.ID] = l.UnitPrice
	}
	for i := range in.Lines {
		if in.Lines[i].UnitPrice == nil && in.Lines[i].ID != 0 {
			if p, ok := prices[in.Lines[i].ID]; ok && p != nil {
				v := *p
				in.Lines[i].UnitPrice = &v
			}
		}
	}
	return nil
}
