package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"kho/internal/apperr"
	"kho/internal/ext"
	"kho/internal/util"
)

// ---------- Ngữ cảnh: công tắc tính năng + quyền của người dùng ----------

type extCtx struct {
	st    *ext.State
	perms ext.Set
}

const extKey ctxKey = 2

func extOf(r *http.Request) *extCtx {
	if x, ok := r.Context().Value(extKey).(*extCtx); ok {
		return x
	}
	return &extCtx{st: &ext.State{Flags: map[string]bool{}}, perms: ext.Set{}}
}

func (s *Server) loadExt(ctx context.Context, role string) (*extCtx, error) {
	st, err := ext.Load(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	p, err := ext.PermsFor(ctx, s.Pool, st, role)
	if err != nil {
		return nil, err
	}
	return &extCtx{st: st, perms: p}, nil
}

// need trả lỗi 403 nếu người dùng thiếu quyền.
func need(r *http.Request, perms ...string) error { return ext.Need(extOf(r).perms, perms...) }

// featureOn trả lỗi 404 FEATURE_OFF nếu tính năng tắt.
func featureOn(r *http.Request, key string) error {
	if !extOf(r).st.On(key) {
		return apperr.FeatureOff(ext.FeatureNames[key])
	}
	return nil
}

func can(r *http.Request, p string) bool { return extOf(r).perms.Has(p) }

// docWritePerm là quyền lập/sửa chứng từ theo loại.
func docWritePerm(docType string) string {
	switch docType {
	case "purchase", "purchase_return":
		return ext.PPurchaseWrite
	case "transfer", "opening", "stocktake":
		return ext.PStockWrite
	default:
		return ext.PSaleWrite
	}
}

// costDocTypes: chứng từ mà đơn giá / thành tiền là giá mua (che khi thiếu cost.view).
var costDocTypes = map[string]bool{"purchase": true, "purchase_return": true, "opening": true}

// ---------- Che số liệu theo quyền (máy chủ) ----------

type maskRules struct {
	noCost, noDebt, noCash, noReport bool
	// sumVisible: sum_total_amount của danh sách chứng từ vẫn hiện được (bộ lọc chỉ gồm loại không che).
	sumVisible bool
}

func (m maskRules) active() bool { return m.noCost || m.noDebt || m.noCash || m.noReport }

func rulesFor(r *http.Request) maskRules {
	x := extOf(r)
	m := maskRules{noCost: !x.perms.Has(ext.PCostView), noDebt: !x.perms.Has(ext.PDebtView),
		noCash: !x.perms.Has(ext.PCashView), noReport: !x.perms.Has(ext.PReportView)}
	if t := strings.TrimSpace(r.URL.Query().Get("type")); t != "" {
		m.sumVisible = true
		for _, x := range strings.Split(t, ",") {
			if costDocTypes[strings.TrimSpace(x)] {
				m.sumVisible = false
			}
		}
	}
	return m
}

func (m maskRules) walk(v any) any {
	switch x := v.(type) {
	case []any:
		for i := range x {
			x[i] = m.walk(x[i])
		}
		return x
	case map[string]any:
		for k, val := range x {
			x[k] = m.walk(val)
		}
		m.maskObject(x)
		return x
	}
	return v
}

func nullKeys(o map[string]any, keys ...string) {
	for _, k := range keys {
		if _, ok := o[k]; ok {
			o[k] = nil
		}
	}
}

func (m maskRules) maskObject(o map[string]any) {
	if m.noCost {
		nullKeys(o, "purchase_price", "cost_price", "unit_cost", "total_payable", "opening_payable", "payable", "cost_source")
		if dt, ok := o["doc_type"].(string); ok && costDocTypes[dt] {
			nullKeys(o, "unit_price", "amount", "total_amount", "old_debt", "total_debt", "goods_amount", "tax_amount", "amount_in_words",
				"amount_with_tax")
			if lines, ok := o["lines"].([]any); ok {
				for _, l := range lines {
					if lm, ok := l.(map[string]any); ok {
						nullKeys(lm, "unit_price", "amount", "tax_amount", "amount_with_tax")
					}
				}
			}
		}
		if t, _ := o["type"].(string); t == "loss" {
			o["message"] = fmt.Sprintf("Dòng %v (%v): giá bán thấp hơn giá mua — bán lỗ", o["line_no"], o["product_code"])
		}
		if _, ok := o["sum_total_amount"]; ok && !m.sumVisible {
			o["sum_total_amount"] = nil
		}
	}
	if m.noDebt {
		nullKeys(o, "old_debt", "total_debt", "total_receivable", "total_payable", "opening_receivable", "opening_payable", "receivable", "payable",
			"credit_limit", "total_after", "over")
		// Lời nhắn của CREDIT_WARNING có in số nợ / hạn mức ⇒ thay bằng lời nhắn không có con số (QA M-01).
		if code, _ := o["code"].(string); code == apperr.CodeCreditWarning {
			if _, ok := o["message"]; ok {
				name := ""
				if d, ok := o["details"].(map[string]any); ok {
					if c, ok := d["credit"].(map[string]any); ok {
						name, _ = c["partner_name"].(string)
					}
				}
				msg := "Khách " + name + " sẽ vượt hạn mức công nợ nếu ghi sổ phiếu này (bạn không có quyền xem số nợ). Bấm xác nhận để vẫn ghi sổ."
				if d, ok := o["details"].(map[string]any); ok {
					if need, ok := d["confirm"].([]any); ok && len(need) > 1 {
						msg += " Phiếu cũng có mặt hàng bán thấp hơn giá mua (bán lỗ)."
					}
				}
				o["message"] = msg
			}
		}
	}
	if m.noCash {
		nullKeys(o, "cash_balance", "bank_balance", "opening_balance")
	}
	if m.noReport {
		nullKeys(o, "revenue_today", "revenue_month")
	}
}

// maskWriter đệm phản hồi JSON để che số liệu; luồng SSE / file đi thẳng.
type maskWriter struct {
	w      http.ResponseWriter
	rules  maskRules
	status int
	mode   int // 0 chưa quyết, 1 đệm JSON, 2 đi thẳng
	buf    bytes.Buffer
}

func (m *maskWriter) Header() http.Header { return m.w.Header() }

func (m *maskWriter) WriteHeader(code int) {
	if m.mode != 0 {
		return
	}
	m.status = code
	if strings.HasPrefix(m.w.Header().Get("Content-Type"), "application/json") {
		m.mode = 1
		return
	}
	m.mode = 2
	m.w.WriteHeader(code)
}

func (m *maskWriter) Write(b []byte) (int, error) {
	if m.mode == 0 {
		m.WriteHeader(http.StatusOK)
	}
	if m.mode == 1 {
		return m.buf.Write(b)
	}
	return m.w.Write(b)
}

func (m *maskWriter) Flush() {
	if m.mode == 2 {
		if f, ok := m.w.(http.Flusher); ok {
			f.Flush()
		}
	}
}

func (m *maskWriter) finish() {
	if m.mode != 1 {
		return
	}
	out := m.buf.Bytes()
	dec := json.NewDecoder(bytes.NewReader(out))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err == nil {
		if b, err := json.Marshal(m.rules.walk(v)); err == nil {
			out = append(b, '\n')
		}
	}
	m.w.Header().Del("Content-Length")
	m.w.WriteHeader(m.status)
	_, _ = m.w.Write(out)
}

// withExt nạp công tắc + quyền vào ngữ cảnh và bật che số liệu khi người dùng thiếu quyền xem.
func (s *Server) withExt(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := userOf(r)
		x, err := s.loadExt(r.Context(), u.Role)
		if err != nil {
			writeErr(w, r, err)
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), extKey, x))
		rules := rulesFor(r)
		if !rules.active() {
			next.ServeHTTP(w, r)
			return
		}
		mw := &maskWriter{w: w, rules: rules}
		next.ServeHTTP(mw, r)
		mw.finish()
	})
}

// ---------- Endpoint: tính năng, ma trận quyền, khóa sổ ----------

// featuresResponse: {"edition", "features": {key: bật}, "items": [{key, name, description, available, enabled}]}.
func featuresResponse(st *ext.State) map[string]any {
	items := make([]map[string]any, 0, len(ext.FeatureKeys))
	for _, k := range ext.FeatureKeys {
		items = append(items, map[string]any{"key": k, "name": ext.FeatureNames[k], "description": ext.FeatureDescriptions[k],
			"available": ext.AvailableFeatures[k], "enabled": st.On(k)})
	}
	edition := "base"
	if st.Edition == "extended" {
		edition = "extended"
	}
	keys := make([]map[string]string, 0, len(ext.FeatureKeys)) // giữ từ M1 để tương thích; dùng "items"
	for _, k := range ext.FeatureKeys {
		keys = append(keys, map[string]string{"key": k, "name": ext.FeatureNames[k]})
	}
	return map[string]any{"edition": edition, "features": st.AllFlags(), "items": items, "keys": keys}
}

func (s *Server) getFeatures(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, featuresResponse(extOf(r).st))
}

func (s *Server) putFeatures(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Features map[string]json.RawMessage `json:"features"`
		Confirm  bool                       `json:"confirm"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	// Mỗi giá trị phải đúng là true / false (null, chuỗi, số ⇒ 400; không để máy khách lỗi vô tình tắt tính năng).
	var flags map[string]bool
	if in.Features != nil {
		flags = make(map[string]bool, len(in.Features))
	}
	for k, raw := range in.Features {
		switch string(bytes.TrimSpace(raw)) {
		case "true":
			flags[k] = true
		case "false":
			flags[k] = false
		default:
			writeErr(w, r, apperr.New(http.StatusBadRequest, apperr.CodeValidation,
				fmt.Sprintf("Giá trị của tính năng %q phải là true hoặc false", k), map[string]any{"field": "features." + k}))
			return
		}
	}
	st, err := ext.SaveFeatures(r.Context(), s.Pool, userOf(r).ID, flags, in.Confirm)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publish(r, eventFeatures())
	writeJSON(w, http.StatusOK, featuresResponse(st))
}

func (s *Server) getRolePermissions(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPermissions); err != nil {
		writeErr(w, r, err)
		return
	}
	m, err := ext.RoleMatrix(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rolePermResponse(m))
}

func rolePermResponse(m map[string][]string) map[string]any {
	perms := make([]map[string]string, 0, len(ext.Permissions))
	for _, p := range ext.Permissions {
		perms = append(perms, map[string]string{"key": p, "name": ext.PermissionNames[p]})
	}
	roles := make([]map[string]string, 0, len(ext.Roles))
	for _, ro := range ext.Roles {
		roles = append(roles, map[string]string{"key": ro, "name": ext.RoleNames[ro]})
	}
	m["admin"] = append([]string{}, ext.Permissions...)
	return map[string]any{"matrix": m, "permissions": perms, "roles": roles}
}

func (s *Server) putRolePermissions(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPermissions); err != nil {
		writeErr(w, r, err)
		return
	}
	var in struct {
		Matrix map[string][]string `json:"matrix"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	m, err := ext.SaveRoleMatrix(r.Context(), s.Pool, userOf(r).ID, in.Matrix)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publish(r, eventFeatures())
	writeJSON(w, http.StatusOK, rolePermResponse(m))
}

func (s *Server) getPeriodLock(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPeriodLock); err != nil {
		writeErr(w, r, err)
		return
	}
	hist, err := s.periodLockHistory(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lock_date": extOf(r).st.RawLockDate(), "history": hist})
}

func (s *Server) putPeriodLock(w http.ResponseWriter, r *http.Request) {
	if err := featureOn(r, ext.FPeriodLock); err != nil {
		writeErr(w, r, err)
		return
	}
	var in struct {
		LockDate util.OptDate `json:"lock_date"`
		Reason   string       `json:"reason"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if !in.LockDate.Set {
		writeErr(w, r, apperr.ValidationField("lock_date", "Thiếu ngày khóa sổ (lock_date); gửi lock_date: null để bỏ khóa sổ"))
		return
	}
	var lock *util.Date
	if !in.LockDate.Val.Empty() {
		lock = &in.LockDate.Val
	}
	got, err := ext.SetLockDate(r.Context(), s.Pool, userOf(r).ID, lock, in.Reason)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publish(r, eventFeatures())
	writeJSON(w, http.StatusOK, map[string]any{"lock_date": got})
}
