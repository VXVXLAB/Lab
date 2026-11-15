package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"golang.org/x/text/unicode/norm"

	"kho/internal/apperr"
	"kho/internal/auth"
	"kho/internal/export"
	"kho/internal/util"
)

type ctxKey int

const userKey ctxKey = 1

func userOf(r *http.Request) *auth.User {
	u, _ := r.Context().Value(userKey).(*auth.User)
	return u
}

func withUser(ctx context.Context, u *auth.User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	ae := apperr.From(err)
	if ae.Status >= 500 {
		log.Printf("LỖI %s %s: %v", r.Method, r.URL.Path, err)
	}
	writeJSON(w, ae.Status, map[string]any{"error": ae})
}

const maxBody = 5 << 20

// errNUL là lỗi khi dữ liệu nhập có ký tự NUL (PostgreSQL không lưu được ký tự này trong TEXT).
func errNUL(field string) error {
	return apperr.ValidationField(field, "Dữ liệu không được chứa ký tự NUL (\\0). Vui lòng xóa ký tự lạ rồi nhập lại.")
}

// hasJSONNul cho biết body JSON có ký tự NUL (byte 0 hoặc chuỗi thoát \u0000 không bị thoát lại).
func hasJSONNul(b []byte) bool {
	if bytes.IndexByte(b, 0) >= 0 {
		return true
	}
	for i := 0; ; {
		j := bytes.Index(b[i:], []byte(`u0000`))
		if j < 0 {
			return false
		}
		k := i + j // vị trí 'u'
		// Đếm số dấu \ liền trước: lẻ ⇒ là chuỗi thoát \u0000.
		n := 0
		for m := k - 1; m >= 0 && b[m] == '\\'; m-- {
			n++
		}
		if n%2 == 1 {
			return true
		}
		i = k + 1
	}
}

func decode(r *http.Request, v any) error {
	raw, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxBody))
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return apperr.Validation("Dữ liệu gửi lên quá lớn")
		}
		return apperr.Validation("Không đọc được dữ liệu gửi lên")
	}
	if hasJSONNul(raw) {
		return errNUL("")
	}
	raw = nfcJSON(raw)
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(v); err != nil {
		if errors.Is(err, io.EOF) {
			return apperr.Validation("Thiếu dữ liệu gửi lên (JSON)")
		}
		var te *json.UnmarshalTypeError
		if errors.As(err, &te) {
			return apperr.ValidationField(te.Field, fmt.Sprintf("Trường %q sai kiểu dữ liệu", te.Field))
		}
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return apperr.Validation("Dữ liệu gửi lên quá lớn")
		}
		return apperr.Validation("Dữ liệu gửi lên không đúng định dạng JSON: %s", err.Error())
	}
	return nil
}

func pathID(r *http.Request) (int64, error) {
	s := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id <= 0 {
		return 0, apperr.NotFound("dữ liệu (mã số không hợp lệ)")
	}
	return id, nil
}

func qInt64(r *http.Request, name string) (*int64, error) {
	s := strings.TrimSpace(r.URL.Query().Get(name))
	if s == "" {
		return nil, nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return nil, apperr.ValidationField(name, fmt.Sprintf("Tham số %s phải là số nguyên", name))
	}
	return &v, nil
}

func qInt(r *http.Request, name string, def int) (int, error) {
	s := strings.TrimSpace(r.URL.Query().Get(name))
	if s == "" {
		return def, nil
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, apperr.ValidationField(name, fmt.Sprintf("Tham số %s phải là số nguyên", name))
	}
	return v, nil
}

func qDate(r *http.Request, name string) (*util.Date, error) {
	s := strings.TrimSpace(r.URL.Query().Get(name))
	if s == "" {
		return nil, nil
	}
	d, err := util.ParseDate(s)
	if err != nil {
		return nil, apperr.ValidationField(name, fmt.Sprintf("Tham số %s: ngày không hợp lệ (YYYY-MM-DD)", name))
	}
	return &d, nil
}

func qBool(r *http.Request, name string) (*bool, error) {
	s := strings.ToLower(strings.TrimSpace(r.URL.Query().Get(name)))
	switch s {
	case "":
		return nil, nil
	case "true", "1", "yes":
		b := true
		return &b, nil
	case "false", "0", "no":
		b := false
		return &b, nil
	case "all":
		return nil, nil
	}
	return nil, apperr.ValidationField(name, fmt.Sprintf("Tham số %s phải là true hoặc false", name))
}

func listParams(r *http.Request, defSize, maxSize int) (util.ListParams, error) {
	var p util.ListParams
	var err error
	p.Q = strings.TrimSpace(r.URL.Query().Get("q"))
	if p.Page, err = qInt(r, "page", 1); err != nil {
		return p, err
	}
	if p.PageSize, err = qInt(r, "page_size", defSize); err != nil {
		return p, err
	}
	if p.Active, err = qBool(r, "active"); err != nil {
		return p, err
	}
	p.Normalize(defSize, maxSize)
	return p, nil
}

// firstErr trả lỗi đầu tiên khác nil.
func firstErr(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}

// sendFile gửi file xuất (xlsx/docx) với tên file an toàn; thêm thông tin công ty (nếu đã khai báo) lên đầu file.
func (s *Server) sendFile(w http.ResponseWriter, r *http.Request, format, baseName string, t export.Table) error {
	if st, err := s.Catalog.GetSettings(r.Context(), s.Pool); err == nil {
		t.Company = st.HeaderLines()
	} else {
		return err
	}
	var data []byte
	var err error
	var mime string
	switch format {
	case "xlsx":
		data, err = export.XLSX(t)
		mime = export.MimeXLSX
	case "docx":
		data, err = export.DOCX(t)
		mime = export.MimeDOCX
	default:
		return apperr.ValidationField("format", "format phải là xlsx hoặc docx")
	}
	if err != nil {
		return err
	}
	name := baseName + "." + format
	ascii := asciiName(name)
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, ascii, url.PathEscape(name)))
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	return nil
}

func asciiName(s string) string {
	f := util.StripAccents(s)
	var b strings.Builder
	for _, r := range f {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('_')
		}
	}
	return b.String()
}

// rejectNUL chặn tham số truy vấn có ký tự NUL (trả 400 thay vì lỗi CSDL).
func rejectNUL(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.ContainsRune(r.URL.Path, 0) {
			writeErr(w, r, errNUL(""))
			return
		}
		for k, vs := range r.URL.Query() {
			if strings.ContainsRune(k, 0) {
				writeErr(w, r, errNUL(""))
				return
			}
			for _, v := range vs {
				if strings.ContainsRune(v, 0) {
					writeErr(w, r, errNUL(k))
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// peekDoc đọc trước doc_type và id của body chứng từ (không báo lỗi kiểu dữ liệu) để kiểm tra quyền TRƯỚC khi giải
// mã đầy đủ (QUYET_DINH N8: thiếu quyền ⇒ 403 dù dữ liệu sai). Body được giữ nguyên cho decode sau đó.
func peekDoc(r *http.Request) (docType string, id int64) {
	raw, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxBody))
	r.Body = io.NopCloser(bytes.NewReader(raw))
	if err != nil {
		return "", 0
	}
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return "", 0
	}
	_ = json.Unmarshal(m["doc_type"], &docType)
	_ = json.Unmarshal(m["id"], &id)
	return docType, id
}

// nfcJSON chuẩn hóa Unicode NFC mọi chuỗi trong body JSON (QA M-09: chữ dạng tổ hợp NFD chép từ macOS / trình soạn thảo
// làm tìm kiếm không ra và tạo được hai mã trông giống hệt nhau). Ký tự cấu trúc JSON đều là ASCII nên chuẩn hóa cả khối
// byte là an toàn; chuỗi có thoát \uXXXX được giải mã, chuẩn hóa rồi mã hóa lại.
func nfcJSON(raw []byte) []byte {
	if bytes.Contains(raw, []byte(`\u`)) {
		var v any
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		if dec.Decode(&v) == nil && !dec.More() {
			if b, err := json.Marshal(nfcValue(v)); err == nil {
				return b
			}
		}
	}
	for _, c := range raw {
		if c >= 0x80 {
			return norm.NFC.Bytes(raw)
		}
	}
	return raw
}

func nfcValue(v any) any {
	switch x := v.(type) {
	case string:
		return util.NFC(x)
	case []any:
		for i := range x {
			x[i] = nfcValue(x[i])
		}
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			out[util.NFC(k)] = nfcValue(e)
		}
		return out
	}
	return v
}

// nfcQuery: middleware chuẩn hóa NFC các giá trị trong query string (ô tìm kiếm, mã...).
func nfcQuery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if q := r.URL.RawQuery; q != "" && (strings.Contains(q, "%") || hasNonASCII(q)) {
			if vals, err := url.ParseQuery(q); err == nil {
				changed := false
				for k, vs := range vals {
					for i, v := range vs {
						if n := util.NFC(v); n != v {
							vs[i], changed = n, true
						}
					}
					vals[k] = vs
				}
				if changed {
					r.URL.RawQuery = vals.Encode()
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func hasNonASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return true
		}
	}
	return false
}
