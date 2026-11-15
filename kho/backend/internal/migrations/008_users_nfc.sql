-- Sửa sau QA: chuẩn hóa NFC tên đăng nhập / họ tên đã lưu (mật khẩu không đổi được ở đây — đăng nhập tự băm lại khi khớp
-- ở dạng khác NFC). Bỏ qua dòng mà bản NFC trùng tên đăng nhập khác.
DO $$
DECLARE r RECORD;
BEGIN
  IF getdatabaseencoding() <> 'UTF8' THEN
    RETURN;
  END IF;
  FOR r IN SELECT id FROM users WHERE username IS NOT NFC NORMALIZED OR full_name IS NOT NFC NORMALIZED LOOP
    BEGIN
      UPDATE users SET username = normalize(username, NFC), full_name = normalize(full_name, NFC) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END $$;
