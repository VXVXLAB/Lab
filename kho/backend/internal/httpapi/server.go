// Package httpapi: router HTTP (chi), xác thực cookie, các endpoint JSON /api, SSE, file tĩnh SPA.
package httpapi

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"kho/internal/apperr"
	"kho/internal/auth"
	"kho/internal/cash"
	"kho/internal/catalog"
	"kho/internal/docs"
	"kho/internal/events"
	"kho/internal/ext"
	"kho/internal/reports"
)

// CookieName là tên cookie phiên.
const CookieName = "session"

// Server gom các dịch vụ.
type Server struct {
	Pool         *pgxpool.Pool
	Auth         *auth.Service
	Catalog      *catalog.Service
	Docs         *docs.Service
	Cash         *cash.Service
	Reports      *reports.Service
	Events       *events.Broker
	StaticDir    string
	SecureCookie bool
	// KeepAlive là chu kỳ gửi ping SSE (mặc định 25s).
	KeepAlive time.Duration
	// Quiet tắt log truy cập.
	Quiet bool
}

// Config là cấu hình tạo Server.
type Config struct {
	Pool         *pgxpool.Pool
	StaticDir    string
	SecureCookie bool
	BcryptCost   int
	Quiet        bool
}

// New tạo Server với đầy đủ dịch vụ.
func New(c Config) *Server {
	cat := &catalog.Service{Pool: c.Pool}
	return &Server{
		Pool:         c.Pool,
		Auth:         &auth.Service{Pool: c.Pool, BcryptCost: c.BcryptCost},
		Catalog:      cat,
		Docs:         &docs.Service{Pool: c.Pool, Catalog: cat},
		Cash:         &cash.Service{Pool: c.Pool, Catalog: cat},
		Reports:      &reports.Service{Pool: c.Pool},
		Events:       events.NewBroker(),
		StaticDir:    c.StaticDir,
		SecureCookie: c.SecureCookie,
		KeepAlive:    25 * time.Second,
		Quiet:        c.Quiet,
	}
}

// Handler trả http.Handler của toàn bộ ứng dụng.
func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP)
	if !s.Quiet {
		r.Use(middleware.Logger)
	}
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Use(rejectNUL)
		r.Use(nfcQuery)
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			if err := s.Pool.Ping(r.Context()); err != nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		})
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)

		r.Group(func(r chi.Router) {
			r.Use(s.requireAuth)
			r.Use(s.withExt)
			r.Get("/auth/me", s.me)
			r.Get("/features", s.getFeatures)
			r.With(requireAdmin).Put("/features", s.putFeatures)
			r.With(requireAdmin).Get("/role-permissions", s.getRolePermissions)
			r.With(requireAdmin).Put("/role-permissions", s.putRolePermissions)
			r.Get("/period-lock", s.getPeriodLock)
			r.With(requireAdmin).Put("/period-lock", s.putPeriodLock)
			r.With(requireAdmin).Get("/audit", s.listAudit)
			r.Get("/settings/vat", s.getVatSettings)
			r.With(requireAdmin).Put("/settings/vat", s.putVatSettings)
			r.Get("/print-template", s.getPrintTemplate)
			r.With(requireAdmin).Put("/print-template", s.putPrintTemplate)
			r.Get("/print-template/logo", s.getLogo)
			r.With(requireAdmin).Put("/print-template/logo", s.putLogo)
			r.With(requireAdmin).Post("/print-template/logo", s.putLogo) // multipart từ form tải file
			r.With(requireAdmin).Delete("/print-template/logo", s.deleteLogo)
			r.Get("/import/{kind}/template", s.importTemplate)
			r.Post("/import/{kind}", s.importRun)
			r.Post("/auth/change-password", s.changePassword)
			r.Get("/settings", s.getSettings)
			r.With(requireAdmin).Put("/settings", s.putSettings)
			r.Get("/events", s.sse)

			r.Route("/users", func(r chi.Router) {
				r.Use(requireAdmin)
				r.Get("/", s.listUsers)
				r.Post("/", s.createUser)
				r.Put("/{id}", s.updateUser)
			})

			s.catalogRoutes(r)

			r.Route("/documents", func(r chi.Router) {
				r.Get("/", s.listDocuments)
				r.Post("/", s.createDocument)
				r.Post("/check", s.checkDocumentInput)
				r.Get("/stocktake-load", s.stocktakeLoad)
				r.Get("/{id}", s.getDocument)
				r.Put("/{id}", s.updateDocument)
				r.Delete("/{id}", s.deleteDocument)
				r.Post("/{id}/post", s.postDocument)
				r.Post("/{id}/unpost", s.unpostDocument)
				r.Get("/{id}/check", s.checkDocument)
				r.Get("/{id}/export", s.exportDocument)
				r.Get("/{id}/history", s.documentHistory)
			})
			r.Route("/vouchers", func(r chi.Router) {
				r.Get("/", s.listVouchers)
				r.Post("/", s.createVoucher)
				r.Get("/{id}", s.getVoucher)
				r.Put("/{id}", s.updateVoucher)
				r.Delete("/{id}", s.deleteVoucher)
				r.Get("/{id}/export", s.exportVoucher)
				r.Get("/{id}/history", s.voucherHistory)
			})
			r.Route("/reports", func(r chi.Router) {
				r.Get("/stock-summary", s.reportStockSummary)
				r.Get("/stock-nxt", s.reportStockNXT)
				r.Get("/stock-ledger", s.reportStockLedger)
				r.Get("/sales", s.reportTrade("sales"))
				r.Get("/purchases", s.reportTrade("purchases"))
				r.Get("/debt-summary", s.reportDebtSummary)
				r.Get("/debt-ledger", s.reportDebtLedger)
				r.Get("/cash-book", s.reportCashBook)
				r.Get("/draft-demand", s.reportDraftDemand)
				r.Get("/low-stock", s.reportLowStock)
				r.Get("/debt-aging", s.reportDebtAging)
				r.Get("/profit", s.reportProfit)
				r.Get("/vat-summary", s.reportVat)
			})
			r.Get("/dashboard", s.dashboard)
		})
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, r, apperr.NotFound("đường dẫn API "+r.URL.Path))
		})
		r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
			writeErr(w, r, apperr.New(http.StatusMethodNotAllowed, apperr.CodeValidation, "Phương thức không được hỗ trợ", nil))
		})
	})
	r.Handle("/*", s.static())
	return r
}

// ---------- Xác thực ----------

func (s *Server) tokenOf(r *http.Request) string {
	if c, err := r.Cookie(CookieName); err == nil && c.Value != "" {
		return c.Value
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return ""
}

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := s.Auth.UserBySession(r.Context(), s.tokenOf(r))
		if err != nil {
			writeErr(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(withUser(r.Context(), u)))
	})
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !userOf(r).IsAdmin() {
			writeErr(w, r, apperr.Forbidden("Chỉ quản trị mới có quyền thực hiện thao tác này"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeRaw(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	u, token, err := s.Auth.Login(r.Context(), in.Username, in.Password)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: s.SecureCookie, MaxAge: int(auth.SessionTTL.Seconds())})
	// Như /auth/me: kèm quyền và công tắc tính năng (giao diện khỏi gọi thêm /auth/me).
	x, err := s.loadExt(r.Context(), u.Role)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u, "permissions": x.perms.List(), "features": x.st.AllFlags()})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if t := s.tokenOf(r); t != "" {
		_ = s.Auth.Logout(r.Context(), t)
	}
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.SecureCookie, MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	x := extOf(r)
	writeJSON(w, http.StatusOK, map[string]any{"user": userOf(r), "permissions": x.perms.List(), "features": x.st.AllFlags()})
}

func eventFeatures() events.Event {
	return events.Event{Type: "features", Action: "updated"}
}

// checkRole: vai trò mới (banhang, muahang, thukho) chỉ dùng được khi bật tính năng Phân quyền.
func checkRole(r *http.Request, role string) error {
	if ext.IsNewRole(role) && !extOf(r).st.On(ext.FPermissions) {
		return apperr.ValidationField("role", "Vai trò "+ext.RoleNames[role]+" chỉ dùng được khi bật tính năng Phân quyền")
	}
	return nil
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := decodeRaw(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if err := s.Auth.ChangePassword(r.Context(), userOf(r).ID, s.tokenOf(r), in.OldPassword, in.NewPassword); err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	st, err := s.Catalog.GetSettings(r.Context(), s.Pool)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var in catalog.SettingsInput
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	st, err := s.Catalog.SaveSettings(r.Context(), userOf(r).ID, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishCatalog(r, "settings", 1, "updated")
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	list, err := s.Auth.ListUsers(r.Context())
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list, "total": len(list), "page": 1, "page_size": len(list)})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var in auth.UserInput
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if err := checkRole(r, in.Role); err != nil {
		writeErr(w, r, err)
		return
	}
	in.ActorID = userOf(r).ID
	u, err := s.Auth.CreateUser(r.Context(), in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishCatalog(r, "user", u.ID, "created")
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var in auth.UserInput
	if err := decode(r, &in); err != nil {
		writeErr(w, r, err)
		return
	}
	if err := checkRole(r, in.Role); err != nil {
		writeErr(w, r, err)
		return
	}
	in.ActorID = userOf(r).ID
	u, err := s.Auth.UpdateUser(r.Context(), id, in)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	s.publishCatalog(r, "user", u.ID, "updated")
	writeJSON(w, http.StatusOK, u)
}

// ---------- SSE ----------

func (s *Server) publish(r *http.Request, e events.Event) {
	if u := userOf(r); u != nil {
		e.By, e.ByID = u.FullName, u.ID
	}
	s.Events.Publish(e)
}

func (s *Server) publishCatalog(r *http.Request, entity string, id int64, action string) {
	s.publish(r, events.Event{Type: "catalog.changed", Entity: entity, ID: id, Action: action})
}

func (s *Server) sse(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, r, fmt.Errorf("streaming không được hỗ trợ"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	ch, cancel := s.Events.Subscribe()
	defer cancel()
	fmt.Fprint(w, "retry: 3000\n: connected\n\n")
	fl.Flush()
	ka := s.KeepAlive
	if ka <= 0 {
		ka = 25 * time.Second
	}
	tick := time.NewTicker(ka)
	defer tick.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(e)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
				return
			}
			fl.Flush()
		case <-tick.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

// ---------- File tĩnh (SPA) ----------

func (s *Server) static() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Phương thức không được hỗ trợ", http.StatusMethodNotAllowed)
			return
		}
		dir := s.StaticDir
		index := filepath.Join(dir, "index.html")
		clean := filepath.Clean("/" + r.URL.Path)
		p := filepath.Join(dir, filepath.FromSlash(clean))
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			if strings.HasPrefix(clean, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeFile(w, r, p)
			return
		}
		if _, err := os.Stat(index); err != nil {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, "Chưa có giao diện (thư mục frontend chưa được build). API vẫn hoạt động tại /api.")
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, index)
	})
}

// LogStartup ghi log thông tin khởi động.
func LogStartup(addr, staticDir string) {
	log.Printf("Máy chủ quản lý kho đang chạy tại %s (file tĩnh: %s)", addr, staticDir)
}
