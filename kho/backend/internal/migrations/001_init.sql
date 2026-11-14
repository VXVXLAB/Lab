-- Lược đồ CSDL khởi tạo — xem docs/SPEC.md mục 3.
-- Không lưu sẵn số tồn hay số công nợ: mọi con số tính từ stock_movements / chứng từ.

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'ketoan')),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));

CREATE TABLE sessions (
    token      TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE warehouses (
    id     BIGSERIAL PRIMARY KEY,
    code   TEXT NOT NULL,
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX warehouses_code_uq ON warehouses (upper(code));

CREATE TABLE product_groups (
    id     BIGSERIAL PRIMARY KEY,
    code   TEXT NOT NULL,
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX product_groups_code_uq ON product_groups (upper(code));

CREATE TABLE products (
    id             BIGSERIAL PRIMARY KEY,
    code           TEXT NOT NULL,
    name           TEXT NOT NULL,
    unit           TEXT NOT NULL DEFAULT '',
    group_id       BIGINT REFERENCES product_groups (id),
    sale_price     NUMERIC(18, 2) NOT NULL DEFAULT 0,
    purchase_price NUMERIC(18, 2) NOT NULL DEFAULT 0,
    is_service     BOOLEAN NOT NULL DEFAULT FALSE,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    search_key     TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX products_code_uq ON products (upper(code));
CREATE INDEX products_group_idx ON products (group_id);

CREATE TABLE partners (
    id                 BIGSERIAL PRIMARY KEY,
    code               TEXT NOT NULL,
    name               TEXT NOT NULL,
    address            TEXT NOT NULL DEFAULT '',
    phone              TEXT NOT NULL DEFAULT '',
    tax_code           TEXT NOT NULL DEFAULT '',
    is_customer        BOOLEAN NOT NULL DEFAULT FALSE,
    is_supplier        BOOLEAN NOT NULL DEFAULT FALSE,
    opening_receivable NUMERIC(18, 2) NOT NULL DEFAULT 0,
    opening_payable    NUMERIC(18, 2) NOT NULL DEFAULT 0,
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    search_key         TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX partners_code_uq ON partners (upper(code));

CREATE TABLE cash_accounts (
    id              BIGSERIAL PRIMARY KEY,
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('cash', 'bank')),
    opening_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
    active          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX cash_accounts_code_uq ON cash_accounts (upper(code));

CREATE TABLE counters (
    key   TEXT PRIMARY KEY,
    value BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE documents (
    id              BIGSERIAL PRIMARY KEY,
    doc_type        TEXT NOT NULL CHECK (doc_type IN ('purchase', 'sale', 'sale_return', 'purchase_return', 'transfer', 'opening')),
    doc_no          TEXT UNIQUE,
    draft_no        TEXT NOT NULL UNIQUE,
    doc_date        DATE NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('draft', 'posted')),
    partner_id      BIGINT REFERENCES partners (id),
    warehouse_id    BIGINT NOT NULL REFERENCES warehouses (id),
    to_warehouse_id BIGINT REFERENCES warehouses (id),
    note            TEXT NOT NULL DEFAULT '',
    total_amount    NUMERIC(18, 2) NOT NULL DEFAULT 0,
    version         INT NOT NULL DEFAULT 1,
    created_by      BIGINT REFERENCES users (id),
    updated_by      BIGINT REFERENCES users (id),
    posted_by       BIGINT REFERENCES users (id),
    posted_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (to_warehouse_id IS NULL OR to_warehouse_id <> warehouse_id)
);
CREATE INDEX documents_type_status_date_idx ON documents (doc_type, status, doc_date);
CREATE INDEX documents_partner_idx ON documents (partner_id);

CREATE TABLE document_lines (
    id          BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    line_no     INT NOT NULL,
    product_id  BIGINT NOT NULL REFERENCES products (id),
    description TEXT NOT NULL DEFAULT '',
    unit        TEXT NOT NULL DEFAULT '',
    qty         NUMERIC(18, 3) NOT NULL,
    unit_price  NUMERIC(18, 2),
    amount      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    note        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX document_lines_doc_idx ON document_lines (document_id);
CREATE INDEX document_lines_product_idx ON document_lines (product_id);

CREATE TABLE stock_movements (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    line_id      BIGINT NOT NULL REFERENCES document_lines (id) ON DELETE CASCADE,
    product_id   BIGINT NOT NULL REFERENCES products (id),
    warehouse_id BIGINT NOT NULL REFERENCES warehouses (id),
    doc_date     DATE NOT NULL,
    qty_in       NUMERIC(18, 3) NOT NULL DEFAULT 0,
    qty_out      NUMERIC(18, 3) NOT NULL DEFAULT 0,
    unit_cost    NUMERIC(18, 2) NOT NULL DEFAULT 0
);
CREATE INDEX stock_movements_pwd_idx ON stock_movements (product_id, warehouse_id, doc_date);
CREATE INDEX stock_movements_doc_idx ON stock_movements (document_id);

CREATE TABLE cash_vouchers (
    id           BIGSERIAL PRIMARY KEY,
    voucher_type TEXT NOT NULL CHECK (voucher_type IN ('receipt', 'payment')),
    voucher_no   TEXT NOT NULL UNIQUE,
    voucher_date DATE NOT NULL,
    account_id   BIGINT NOT NULL REFERENCES cash_accounts (id),
    partner_id   BIGINT REFERENCES partners (id),
    note         TEXT NOT NULL DEFAULT '',
    total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    version      INT NOT NULL DEFAULT 1,
    created_by   BIGINT REFERENCES users (id),
    updated_by   BIGINT REFERENCES users (id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cash_vouchers_partner_idx ON cash_vouchers (partner_id);
CREATE INDEX cash_vouchers_account_idx ON cash_vouchers (account_id, voucher_date);

CREATE TABLE cash_voucher_lines (
    id          BIGSERIAL PRIMARY KEY,
    voucher_id  BIGINT NOT NULL REFERENCES cash_vouchers (id) ON DELETE CASCADE,
    line_no     INT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount      NUMERIC(18, 2) NOT NULL,
    document_id BIGINT REFERENCES documents (id) ON DELETE SET NULL
);
CREATE INDEX cash_voucher_lines_voucher_idx ON cash_voucher_lines (voucher_id);

CREATE TABLE audit_log (
    id        BIGSERIAL PRIMARY KEY,
    at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id   BIGINT REFERENCES users (id),
    entity    TEXT NOT NULL,
    entity_id BIGINT NOT NULL,
    action    TEXT NOT NULL,
    before    JSONB,
    after     JSONB
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, at);
