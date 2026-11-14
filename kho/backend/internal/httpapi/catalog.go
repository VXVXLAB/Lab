package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"kho/internal/catalog"
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
	r.Get("/products/{id}/price-info", s.priceInfo)
	mount(s, r, "/products", crud[*catalog.Product, catalog.ProductInput]{
		entity: "product",
		list: func(r *http.Request, p util.ListParams) (any, error) {
			g, err1 := qInt64(r, "group_id")
			sv, err2 := qBool(r, "is_service")
			if err := firstErr(err1, err2); err != nil {
				return nil, err
			}
			return cat.ListProducts(r.Context(), catalog.ProductFilter{ListParams: p, GroupID: g, IsService: sv})
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

func (s *Server) lookupProduct(w http.ResponseWriter, r *http.Request) {
	p, err := s.Catalog.LookupProduct(r.Context(), s.Pool, r.URL.Query().Get("code"))
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) priceInfo(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	d, err := qDate(r, "date")
	if err != nil {
		writeErr(w, r, err)
		return
	}
	date := util.Today()
	if d != nil {
		date = *d
	}
	p, err := s.Catalog.GetProduct(r.Context(), s.Pool, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	costs, err := stock.CostPrices(r.Context(), s.Pool, []int64{id}, date)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	byWh, total, err := stock.ByWarehouse(r.Context(), s.Pool, id, date)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	c := costs[id]
	if p.IsService {
		c.Source = "none"
	}
	if c.Source == "" {
		c.Source = "none"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"product_id":         p.ID,
		"code":               p.Code,
		"name":               p.Name,
		"unit":               p.Unit,
		"is_service":         p.IsService,
		"date":               date,
		"sale_price":         p.SalePrice,
		"purchase_price":     p.PurchasePrice,
		"cost_price":         c.Price,
		"cost_source":        c.Source,
		"total_stock":        total,
		"stock_by_warehouse": byWh,
	})
}
