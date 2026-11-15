-- 004: Bản mở rộng đợt M1 — công tắc tính năng, phân quyền theo vai trò, khóa sổ.
-- Chỉ THÊM: cột mới có mặc định, bảng mới; nới ràng buộc vai trò (tập cũ là tập con của tập mới ⇒ an toàn với dữ liệu cũ).

ALTER TABLE settings ADD COLUMN features JSONB NOT NULL DEFAULT '{}'::jsonb;
-- features_initialized: đã gán công tắc lần đầu theo KHO_EDITION chưa (chỉ gán một lần, không bao giờ đè lại).
ALTER TABLE settings ADD COLUMN features_initialized BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN lock_date DATE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'ketoan', 'banhang', 'muahang', 'thukho'));

CREATE TABLE role_permissions (
    role       TEXT NOT NULL CHECK (role IN ('ketoan', 'banhang', 'muahang', 'thukho')),
    permission TEXT NOT NULL,
    PRIMARY KEY (role, permission)
);
INSERT INTO role_permissions (role, permission)
SELECT 'ketoan', p FROM unnest(ARRAY['sale.write','purchase.write','stock.write','cash.write','catalog.write','posted.edit',
                                     'cost.view','debt.view','cash.view','report.view']) AS p
UNION ALL
SELECT 'banhang', p FROM unnest(ARRAY['sale.write','cash.write','debt.view','report.view']) AS p
UNION ALL
SELECT 'muahang', p FROM unnest(ARRAY['purchase.write','stock.write','cash.write','cost.view','debt.view','report.view']) AS p
UNION ALL
SELECT 'thukho', 'stock.write';
