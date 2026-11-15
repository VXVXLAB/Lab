-- 005: giá trị công tắc = giá trị quản trị đặt (nếu có) hoặc mặc định theo bản cài (settings.edition, ghi lại mỗi lần
-- máy chủ khởi động từ KHO_EDITION). settings.features chỉ còn chứa các khóa quản trị đã đặt tường minh;
-- features_initialized không còn dùng (giữ cột cho an toàn).
ALTER TABLE settings ADD COLUMN edition TEXT NOT NULL DEFAULT '';
-- Công tắc do seed gán (chưa từng có quản trị đổi) ⇒ xóa, để theo mặc định của bản cài.
UPDATE settings SET features = '{}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE entity = 'features');
