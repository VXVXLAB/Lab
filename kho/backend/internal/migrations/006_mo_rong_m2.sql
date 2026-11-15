-- 006: Bản mở rộng đợt M2 — tồn tối thiểu (C5), giá theo khách (C6), hạn mức & hạn thanh toán (C8). Chỉ THÊM.
ALTER TABLE products ADD COLUMN min_stock NUMERIC(18, 3);
ALTER TABLE partners ADD COLUMN credit_limit NUMERIC(18, 2);
ALTER TABLE partners ADD COLUMN payment_days INT;

-- Bảng giá riêng theo khách. Là cấu hình (không phải chứng từ) ⇒ xóa đối tác / mặt hàng thì xóa luôn giá riêng.
CREATE TABLE partner_prices (
    partner_id BIGINT NOT NULL REFERENCES partners (id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    price      NUMERIC(18, 2) NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    updated_by BIGINT REFERENCES users (id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (partner_id, product_id)
);
CREATE INDEX partner_prices_product_idx ON partner_prices (product_id);
-- Tra "giá bán gần nhất cho khách" nhanh.
CREATE INDEX documents_partner_type_date_idx ON documents (partner_id, doc_type, status, doc_date);
