-- 003: thông tin công ty in trên đầu phiếu / báo cáo xuất file (một dòng duy nhất, mặc định rỗng).
CREATE TABLE settings (
    id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    company_name     TEXT NOT NULL DEFAULT '',
    company_address  TEXT NOT NULL DEFAULT '',
    company_phone    TEXT NOT NULL DEFAULT '',
    company_tax_code TEXT NOT NULL DEFAULT '',
    updated_by       BIGINT REFERENCES users (id),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1);
