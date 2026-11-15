-- 009: bản mở rộng đợt M3 — C9 kiểm kê, C10 quy đổi đơn vị, C11 thuế GTGT, C12 mẫu in. Chỉ thêm; dữ liệu cũ giữ nguyên
-- ý nghĩa: hệ số 1, không thuế (tổng tiền không đổi), không có tồn sổ sách.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN ('purchase', 'sale', 'sale_return', 'purchase_return', 'transfer', 'opening', 'stocktake'));
-- total_amount = tiền hàng + tiền thuế (tổng thanh toán, dùng cho công nợ); tax_amount = tiền thuế GTGT.
ALTER TABLE documents ADD COLUMN tax_amount NUMERIC(18, 2) NOT NULL DEFAULT 0;

-- Dòng: SL và đơn giá theo đơn vị đã chọn; unit_factor = số đơn vị gốc trong 1 đơn vị đã chọn (chụp lại khi lưu);
-- base_qty = SL quy về đơn vị gốc (làm tròn 3 chữ số) — mọi bút toán kho, kiểm tra tồn, báo cáo SL dùng cột này.
ALTER TABLE document_lines ADD COLUMN unit_factor NUMERIC(18, 6) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE document_lines ADD COLUMN base_qty NUMERIC(18, 3) GENERATED ALWAYS AS (round(qty * unit_factor, 3)) STORED;
-- Thuế suất (NULL = không chịu thuế / không thuế), tiền thuế dòng = round(thành tiền × thuế suất / 100).
ALTER TABLE document_lines ADD COLUMN vat_rate NUMERIC(5, 2) CHECK (vat_rate IN (0, 5, 8, 10));
ALTER TABLE document_lines ADD COLUMN tax_amount NUMERIC(18, 2) NOT NULL DEFAULT 0;
-- Kiểm kê: tồn sổ sách (đơn vị gốc) đã dùng khi ghi sổ.
ALTER TABLE document_lines ADD COLUMN book_qty NUMERIC(18, 3);

-- Thuế suất mặc định của mặt hàng: NULL = theo mặc định chung; 'KCT' = không chịu thuế.
ALTER TABLE products ADD COLUMN vat_rate TEXT CHECK (vat_rate IN ('KCT', '0', '5', '8', '10'));

CREATE TABLE product_units (
    product_id BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    unit       TEXT NOT NULL,
    factor     NUMERIC(18, 6) NOT NULL CHECK (factor > 0),
    updated_by BIGINT REFERENCES users (id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_units_uq ON product_units (product_id, lower(unit));

-- Thuế suất mặc định chung (NULL hoặc 'KCT' = không thuế) và mẫu in.
ALTER TABLE settings ADD COLUMN default_vat TEXT CHECK (default_vat IN ('KCT', '0', '5', '8', '10'));
ALTER TABLE settings ADD COLUMN print_template JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE settings ADD COLUMN logo BYTEA;
ALTER TABLE settings ADD COLUMN logo_type TEXT;
ALTER TABLE settings ADD COLUMN logo_updated_at TIMESTAMPTZ;
