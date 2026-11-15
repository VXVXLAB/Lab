package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shopspring/decimal"

	"kho/internal/apperr"
	"kho/internal/catalog"
	"kho/internal/debt"
	"kho/internal/ext"
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
			if err := need(r, ext.PCatalogWrite); err != nil {
				writeErr(w, r, err)
				return
			}
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
			if err := need(r, ext.PCatalogWrite); err != nil {
				writeErr(w, r, err)
				return
			}
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
			if err := need(r, ext.PCatalogWrite); err != nil {
				writeErr(w, r, err)
				return
			}
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
	r.Get("/partners/{id}/prices", s.listPartnerPrices)
	r.Put("/partners/{id}/prices", s.savePartnerPrices)
	r.Delete("/partners/{id}/prices/{product_id}", s.deletePartnerPrice)
	r.Get("/products/sale-price", s.salePrice)
	r.Get("/products/{id}/price-info", s.priceInfo)
	r.Get("/products/{id}/units", s.listProductUnits)
	r.Put("/products/{id}/units", s.saveProductUnits)
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
				pg, err := cat.ListProductsWithStock(r.Context(), f, wh)
				for i := range pg.Items {
					productOut(r, &pg.Items[i].Product)
				}
				return pg, err
			}
			pg, err := cat.ListProducts(r.Context(), f)
			for i := range pg.Items {
				productOut(r, &pg.Items[i])
			}
			return pg, err
		},
		get: func(r *http.Request, id int64) (*catalog.Product, error) {
			p, err := cat.GetProduct(r.Context(), s.Pool, id)
			if err == nil {
				productOut(r, p)
				s.productUnitsOut(r, p)
			}
			return p, err
		},
		save: func(r *http.Request, uid, id int64, in catalog.ProductInput) (out *catalog.Product, err error) {
			if !extOf(r).st.On(ext.FMinStock) {
				in.MinStock = util.OptDec{} // tính năng tắt ⇒ không đổi tồn tối thiểu
			}
			if !extOf(r).st.On(ext.FVAT) {
				in.VatRate = util.OptStr{} // tính năng tắt ⇒ không đổi thuế suất
			}
			defer func() {
				if out != nil {
					productOut(r, out)
				}
			}()
			// Không có quyền xem giá mua ⇒ không được đặt/đổi giá mua (giữ giá cũ khi sửa, 0 khi tạo).
			if !can(r, ext.PCostView) {
				in.PurchasePrice = nil
				if id != 0 {
					if old, err := cat.GetProduct(r.Context(), s.Pool, id); err == nil {
						in.PurchasePrice = &old.PurchasePrice
					}
				}
			}
			return cat.SaveProduct(r.Context(), uid, id, in)
		},
		del:  func(r *http.Request, uid, id int64) error { return cat.DeleteProduct(r.Context(), uid, id) },
		idOf: func(x *catalog.Product) int64 { return x.ID },
	})
	mount(s, r, "/partners", crud[*catalog.Partner, catalog.PartnerInput]{
		entity: "partner",
		list: func(r *http.Request, p util.ListParams) (any, error) {
			pg, err := cat.ListPartners(r.Context(), catalog.PartnerFilter{ListParams: p, Type: r.URL.Query().Get("type")})
			for i := range pg.Items {
				partnerOut(r, &pg.Items[i])
			}
			return pg, err
		},
		get: func(r *http.Request, id int64) (*catalog.Partner, error) {
			p, err := cat.GetPartner(r.Context(), s.Pool, id)
			if err == nil {
				partnerOut(r, p)
			}
			return p, err
		},
		save: func(r *http.Request, uid, id int64, in catalog.PartnerInput) (out *catalog.Partner, err error) {
			if !extOf(r).st.On(ext.FCreditLimit) {
				in.CreditLimit, in.PaymentDays = util.OptDec{}, util.OptInt{} // tính năng tắt ⇒ không đổi
			}
			defer func() {
				if out != nil {
					partnerOut(r, out)
				}
			}()
			// Không có quyền xem công nợ (hoặc giá mua với nợ phải trả) ⇒ giữ nguyên số dư đầu kỳ đang có.
			hideRec, hidePay := !can(r, ext.PDebtView), !can(r, ext.PDebtView) || !can(r, ext.PCostView)
			if hideRec || hidePay {
				var old *catalog.Partner
				if id != 0 {
					old, _ = cat.GetPartner(r.Context(), s.Pool, id)
				}
				if hideRec {
					in.OpeningReceivable = nil
					if old != nil {
						in.OpeningReceivable = &old.OpeningReceivable
					}
				}
				if hidePay {
					in.OpeningPayable = nil
					if old != nil {
						in.OpeningPayable = &old.OpeningPayable
					}
				}
			}
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
			if !can(r, ext.PCashView) {
				in.OpeningBalance = nil
				if id != 0 {
					if old, err := cat.GetCashAccount(r.Context(), s.Pool, id); err == nil {
						in.OpeningBalance = &old.OpeningBalance
					}
				}
			}
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
	if err == nil {
		productOut(r, p)
		s.productUnitsOut(r, p)
	}
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
	if err := need(r, ext.PDebtView); err != nil {
		writeErr(w, r, err)
		return
	}
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

// productOut: trường min_stock chỉ xuất hiện khi tính năng min_stock bật (tắt ⇒ JSON y như bản chuẩn).
func productOut(r *http.Request, p *catalog.Product) {
	if !extOf(r).st.On(ext.FMinStock) {
		p.MinStock = nil
	} else if p.MinStock == nil {
		p.MinStock = &decimal.NullDecimal{}
	}
	// C11: thuế suất mặc định của mặt hàng chỉ có khi tính năng vat bật.
	if !extOf(r).st.On(ext.FVAT) {
		p.VatRate = nil
	} else if p.VatRate == nil {
		p.VatRate = &util.NullStr{}
	}
}

// productUnitsOut (C10): GET một mặt hàng / tra mã kèm danh sách đơn vị quy đổi khi tính năng bật.
func (s *Server) productUnitsOut(r *http.Request, p *catalog.Product) {
	if p == nil || !extOf(r).st.On(ext.FUnitConversion) {
		return
	}
	if us, err := catalog.ListUnits(r.Context(), s.Pool, p.ID); err == nil {
		p.Units = &us
	}
}

// partnerOut: credit_limit, payment_days chỉ xuất hiện khi tính năng credit_limit bật.
func partnerOut(r *http.Request, p *catalog.Partner) {
	if !extOf(r).st.On(ext.FCreditLimit) {
		p.CreditLimit, p.PaymentDays = nil, nil
		return
	}
	if p.CreditLimit == nil {
		p.CreditLimit = &decimal.NullDecimal{}
	}
	if p.PaymentDays == nil {
		p.PaymentDays = &util.NullInt{}
	}
}
