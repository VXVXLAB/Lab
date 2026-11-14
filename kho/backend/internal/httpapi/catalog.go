package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"kho/internal/apperr"
	"kho/internal/catalog"
	"kho/internal/debt"
	"kho/internal/stock"
	"kho/internal/util"
)

const (
	catalogDefSize = 50
	catalogMaxSize = 1000
)

// crud gom các hàm của một danh mục để dùng chung handler.
type crud[T any, I any] struct {
	entity string
	list   func(r *http.Request, p util.ListParams) (any, error)
	get    func(r *http.Request, id int64) (T, error)
	save   func(r *http.Request, userID, id int64, in I) (T, error)
	del    func(r *http.Request, userID, id int64) error
	idOf   func(T) int64
}

func mount[T any, I any](s *Server, r chi.Router, path string, c crud[T, I]) {
	r.Route(path, func(r chi.Router) {
		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			p, err := listParams(r, catalogDefSize, catalogMaxSize)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			out, err := c.list(r, p)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, out)
		})
		r.Post("/", func(w http.ResponseWriter, r *http.Request) {
			var in I
			if err := decode(r, &in); err != nil {
				writeErr(w, r, err)
				return
			}
			x, err := c.save(r, userOf(r).ID, 0, in)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			s.publishCatalog(r, c.entity, c.idOf(x), "created")
			writeJSON(w, http.StatusCreated, x)
		})
		r.Get("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := pathID(r)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			x, err := c.get(r, id)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			writeJSON(w, http.StatusOK, x)
		})
		r.Put("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := pathID(r)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			var in I
			if err := decode(r, &in); err != nil {
				writeErr(w, r, err)
				return
			}
			x, err := c.save(r, userOf(r).ID, id, in)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			s.publishCatalog(r, c.entity, id, "updated")
			writeJSON(w, http.StatusOK, x)
		})
		r.Delete("/{id}", func(w http.ResponseWriter, r *http.Request) {
			id, err := pathID(r)
			if err != nil {
				writeErr(w, r, err)
				return
			}
			if err := c.del(r, userOf(r).ID, id); err != nil {
				writeErr(w, r, err)
				return
			}
			s.publishCatalog(r, c.entity, id, "deleted")
			writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		})
	})
}

func (s *Server) catalogRoutes(r chi.Router) {
	cat := s.Catalog
	mount(s, r, "/warehouses", crud[*catalog.Warehouse, catalog.WarehouseInput]{
		entity: "warehouse",
		list: func(r *http.Request, p util.ListParams) (any, error) {
			return cat.ListWarehouses(r.Context(), p)
		},
		get: func(r *http.Request, id int64) (*catalog.Warehouse, error) {
			return cat.GetWarehouse(r.Context(), s.Pool, id)
		},
		save: func(r *http.Request, uid, id int64, in catalog.WarehouseInput) (*catalog.Warehouse, error) {
			return cat.SaveWarehouse(r.Context(), uid, id, in)
		},
		del:  func(r *http.Request, uid, id int64) error { return cat.DeleteWarehouse(r.Context(), uid, id) },
		idOf: func(x *catalog.Warehouse) int64 { return x.ID },
	})
	mount(s, r, "/product-groups", crud[*catalog.ProductGroup, catalog.GroupInput]{
		entity: "product_group",
		list: func(r *http.Request, p util.ListParams) (any, error) {
			return cat.ListGroups(r.Context(), p)
		},
		get: func(r *http.Request, id int64) (*catalog.ProductGroup, error) {
			return cat.GetGroup(r.Context(), s.Pool, id)
		},
		save: func(r *http.Request, uid, id int64, in catalog.GroupInput) (*catalog.ProductGroup, error) {
			return cat.SaveGroup(r.Context(), uid, id, in)
		},
		del:  func(r *http.Request, uid, id int64) error { return cat.DeleteGroup(r.Context(), uid, id) },
		idOf: func(x *catalog.ProductGroup) int64 { return x.ID },
	})
	// Các route đặc biệt của mặt hàng phải đăng ký trước /{id}.
	r.Get("/products/lookup", s.lookupProduct)
	r.Get("/products/price-info", s.priceInfoBatch)
	r.Get("/partners/{id}/balance", s.partnerBalance)
	r.Get("/products/{id}/price-info", s.priceInfo)
	mount(s, r, "/products", crud[*catalog.Product, catalog.ProductInput]{
		entity: "product",
		list: func(r *http.Request, p util.ListParams) (any, error) {
			g, err1 := qInt64(r, "group_id")
			sv, err2 := qBool(r, "is_service")
			ws, err3 := qBool(r, "with_stock")
			wh, err4 := qInt64(r, "warehouse_id")
			if err := firstErr(err1, err2, err3, err4); err != nil {
				return nil, err
			}
			f := catalog.ProductFilter{ListParams: p, GroupID: g, IsService: sv}
			if ws != nil && *ws {
				return cat.ListProductsWithStock(r.Context(), f, wh)
			}
			return cat.ListProducts(r.Context(), f)
		},
		get: func(r *http.Request, id int64) (*catalog.Product, error) {
			return cat.GetProduct(r.Context(), s.Pool, id)
		},
		save: func(r *http.Request, uid, id int64, in catalog.ProductInput) (*catalog.Product, error) {
			return cat.SaveProduct(r.Context(), uid, id, in)
		},
		del:  func(r *http.Request, uid, id int64) error { return cat.DeleteProduct(r.Context(), uid, id) },
		idOf: func(x *catalog.Product) int64 { return x.ID },
	})
	mount(s, r, "/partners", crud[*catalog.Partner, catalog.PartnerInput]{
		entity: "partner",
		list: func(r *http.Request, p util.ListParams) (any, error) {
			return cat.ListPartners(r.Context(), catalog.PartnerFilter{ListParams: p, Type: r.URL.Query().Get("type")})
		},
		get: func(r *http.Request, id int64) (*catalog.Partner, error) {
			return cat.GetPartner(r.Context(), s.Pool, id)
		},
		save: func(r *http.Request, uid, id int64, in catalog.PartnerInput) (*catalog.Partner, error) {
			return cat.SavePartner(r.Context(), uid, id, in)
		},
		del:  func(r *http.Request, uid, id int64) error { return cat.DeletePartner(r.Context(), uid, id) },
		idOf: func(x *catalog.Partner) int64 { return x.ID },
	})
	mount(s, r, "/cash-accounts", crud[*catalog.CashAccount, catalog.CashAccountInput]{
		entity: "cash_account",
		list: func(r *http.Request, p util.ListParams) (any, error) {
			return cat.ListCashAccounts(r.Context(), p)
		},
		get: func(r *http.Request, id int64) (*catalog.CashAccount, error) {
			return cat.GetCashAccount(r.Context(), s.Pool, id)
		},
		save: func(r *http.Request, uid, id int64, in catalog.CashAccountInput) (*catalog.CashAccount, error) {
			return cat.SaveCashAccount(r.Context(), uid, id, in)
		},
		del:  func(r *http.Request, uid, id int64) error { return cat.DeleteCashAccount(r.Context(), uid, id) },
		idOf: func(x *catalog.CashAccount) int64 { return x.ID },
	})
}

// lookupProduct: GET /products/lookup?code=X[&optional=1].
// Mặc định: Product hoặc 404. optional=1: luôn 200 {"found": bool, "product": Product|null} (gõ từng chữ không sinh 404).
func (s *Server) lookupProduct(w http.ResponseWriter, r *http.Request) {
	opt, err := qBool(r, "optional")
	if err != nil {
		writeErr(w, r, err)
		return
	}
	p, err := s.Catalog.LookupProduct(r.Context(), s.Pool, r.URL.Query().Get("code"))
	if opt != nil && *opt {
		if err != nil {
			if ae := apperr.From(err); ae.Code == apperr.CodeNotFound {
				writeJSON(w, http.StatusOK, map[string]any{"found": false, "product": nil})
				return
			}
			writeErr(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"found": true, "product": p})
		return
	}
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// maxPriceInfoIDs là số mặt hàng tối đa của một lần gọi price-info hàng loạt.
const maxPriceInfoIDs = 500

func (s *Server) priceInfoParams(r *http.Request) (util.Date, *int64, error) {
	d, err := qDate(r, "date")
	if err != nil {
		return util.Date{}, nil, err
	}
	wh, err := qInt64(r, "warehouse_id")
	if err != nil {
		return util.Date{}, nil, err
	}
	if wh != nil {
		if _, err := s.Catalog.GetWarehouse(r.Context(), s.Pool, *wh); err != nil {
			return util.Date{}, nil, apperr.ValidationField("warehouse_id", "Kho không tồn tại")
		}
	}
	date := util.Today()
	if d != nil {
		date = *d
	}
	return date, wh, nil
}

func (s *Server) priceInfo(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	date, wh, err := s.priceInfoParams(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	list, _, err := stock.PriceInfos(r.Context(), s.Pool, []int64{id}, date, wh)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if len(list) == 0 {
		writeErr(w, r, apperr.NotFound("mặt hàng"))
		return
	}
	writeJSON(w, http.StatusOK, list[0])
}

// priceInfoBatch: GET /products/price-info?ids=1,2,3&date=&warehouse_id=
func (s *Server) priceInfoBatch(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("ids"))
	if raw == "" {
		writeErr(w, r, apperr.ValidationField("ids", "Vui lòng truyền ids (danh sách mã số mặt hàng, cách nhau dấu phẩy)"))
		return
	}
	var ids []int64
	seen := map[int64]bool{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.ParseInt(part, 10, 64)
		if err != nil || id <= 0 {
			writeErr(w, r, apperr.ValidationField("ids", "ids chỉ gồm các số nguyên dương cách nhau dấu phẩy"))
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) > maxPriceInfoIDs {
		writeErr(w, r, apperr.ValidationField("ids", fmt.Sprintf("Tối đa %d mặt hàng mỗi lần", maxPriceInfoIDs)))
		return
	}
	date, wh, err := s.priceInfoParams(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	list, missing, err := stock.PriceInfos(r.Context(), s.Pool, ids, date, wh)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if len(missing) > 0 {
		writeErr(w, r, apperr.New(http.StatusNotFound, apperr.CodeNotFound, fmt.Sprintf("Không tìm thấy mặt hàng có mã số %v", missing), map[string]any{"missing_ids": missing}))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list})
}

// partnerBalance: GET /partners/{id}/balance?date=&exclude_document_id=&exclude_voucher_id=
// Số dư phải thu và phải trả hiện tại của một đối tác (nhẹ hơn sổ chi tiết công nợ).
func (s *Server) partnerBalance(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	date, e1 := qDate(r, "date")
	xd, e2 := qInt64(r, "exclude_document_id")
	xv, e3 := qInt64(r, "exclude_voucher_id")
	if err := firstErr(e1, e2, e3); err != nil {
		writeErr(w, r, err)
		return
	}
	p, err := s.Catalog.GetPartner(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	rec, err := debt.BalanceExcluding(r.Context(), s.Pool, debt.Receivable, id, date, xd, xv)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	pay, err := debt.BalanceExcluding(r.Context(), s.Pool, debt.Payable, id, date, xd, xv)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"partner_id": p.ID, "partner_code": p.Code, "partner_name": p.Name,
		"date": date, "exclude_document_id": xd, "exclude_voucher_id": xv,
		"receivable": rec, "payable": pay,
	})
}
