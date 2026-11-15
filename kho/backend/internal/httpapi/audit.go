package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"kho/internal/apperr"
	"kho/internal/util"
)

// auditRow là một dòng nhật ký (GET /api/audit).
type auditRow struct {
	ID       int64           `json:"id"`
	At       time.Time       `json:"at"`
	UserID   *int64          `json:"user_id"`
	UserName *string         `json:"user_name"`
	Username *string         `json:"username"`
	Entity   string          `json:"entity"`
	EntityID int64           `json:"entity_id"`
	Action   string          `json:"action"`
	Before   json.RawMessage `json:"before"`
	After    json.RawMessage `json:"after"`
}

// listAudit: GET /api/audit?entity=&entity_id=&action=&user_id=&from=&to=&limit=&offset= (chỉ quản trị) — nhật ký mọi thay
// đổi (công tắc tính năng, ma trận quyền, khóa sổ, nhập Excel, danh mục, chứng từ, phiếu thu chi…), mới nhất trước.
// entity / action nhận nhiều giá trị cách nhau dấu phẩy; from/to là ngày theo giờ Việt Nam.
func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	entityID, e1 := qInt64(r, "entity_id")
	userID, e2 := qInt64(r, "user_id")
	from, e3 := qDate(r, "from")
	to, e4 := qDate(r, "to")
	limit, e5 := qInt(r, "limit", 100)
	offset, e6 := qInt(r, "offset", 0)
	if err := firstErr(e1, e2, e3, e4, e5, e6); err != nil {
		writeErr(w, r, err)
		return
	}
	if limit < 1 || limit > 1000 {
		writeErr(w, r, apperr.ValidationField("limit", "limit phải từ 1 đến 1000"))
		return
	}
	if offset < 0 {
		writeErr(w, r, apperr.ValidationField("offset", "offset không được âm"))
		return
	}
	var wh util.Where
	if v := multi(q.Get("entity")); len(v) > 0 {
		wh.Add(`a.entity = ANY(?)`, v)
	}
	if v := multi(q.Get("action")); len(v) > 0 {
		wh.Add(`a.action = ANY(?)`, v)
	}
	if entityID != nil {
		wh.Add(`a.entity_id = ?`, *entityID)
	}
	if userID != nil {
		wh.Add(`a.user_id = ?`, *userID)
	}
	if from != nil {
		wh.Add(`(a.at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= ?`, *from)
	}
	if to != nil {
		wh.Add(`(a.at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <= ?`, *to)
	}
	var total int
	if err := s.Pool.QueryRow(r.Context(), `SELECT count(*) FROM audit_log a`+wh.SQL(), wh.Args...).Scan(&total); err != nil {
		writeErr(w, r, err)
		return
	}
	rows, err := s.Pool.Query(r.Context(), `SELECT a.id, a.at, a.user_id, u.full_name, u.username, a.entity, a.entity_id, a.action, a.before, a.after
		FROM audit_log a LEFT JOIN users u ON u.id = a.user_id`+wh.SQL()+` ORDER BY a.id DESC LIMIT `+wh.Arg(limit)+` OFFSET `+wh.Arg(offset), wh.Args...)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	defer rows.Close()
	items := []auditRow{}
	for rows.Next() {
		var a auditRow
		var before, after []byte
		if err := rows.Scan(&a.ID, &a.At, &a.UserID, &a.UserName, &a.Username, &a.Entity, &a.EntityID, &a.Action, &before, &after); err != nil {
			writeErr(w, r, err)
			return
		}
		a.Before, a.After = rawOrNull(before), rawOrNull(after)
		items = append(items, a)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
}

func multi(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func rawOrNull(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("null")
	}
	return json.RawMessage(b)
}

// lockHistory là lịch sử đặt / bỏ ngày khóa sổ (từ nhật ký).
type lockHistory struct {
	At          time.Time  `json:"at"`
	UserID      *int64     `json:"user_id"`
	UserName    *string    `json:"user_name"`
	OldLockDate *util.Date `json:"old_lock_date"`
	NewLockDate *util.Date `json:"new_lock_date"`
	Reason      string     `json:"reason"`
}

func (s *Server) periodLockHistory(r *http.Request) ([]lockHistory, error) {
	rows, err := s.Pool.Query(r.Context(), `SELECT a.at, a.user_id, u.full_name,
			NULLIF(a.before->>'lock_date', '')::date, NULLIF(a.after->>'lock_date', '')::date, COALESCE(a.after->>'reason', '')
		FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
		WHERE a.entity = 'period_lock' ORDER BY a.id DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []lockHistory{}
	for rows.Next() {
		var h lockHistory
		var oldD, newD *time.Time
		if err := rows.Scan(&h.At, &h.UserID, &h.UserName, &oldD, &newD, &h.Reason); err != nil {
			return nil, err
		}
		h.OldLockDate, h.NewLockDate = dateOf(oldD), dateOf(newD)
		out = append(out, h)
	}
	return out, rows.Err()
}

func dateOf(t *time.Time) *util.Date {
	if t == nil {
		return nil
	}
	d := util.NewDate(t.Year(), t.Month(), t.Day())
	return &d
}
