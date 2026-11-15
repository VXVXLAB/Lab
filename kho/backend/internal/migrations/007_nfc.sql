-- Bản mở rộng, sửa sau QA (M-09): chuẩn hóa Unicode NFC cho chữ đã lưu trong các bảng danh mục. Từ nay máy chủ chuẩn hóa
-- NFC mọi chuỗi gửi lên (JSON, query string, ô Excel); migration này chuẩn hóa một lần dữ liệu cũ.
-- Từng dòng một, bỏ qua dòng mà bản NFC trùng mã với một dòng khác (không làm hỏng khởi động; dòng đó giữ nguyên).
DO $$
DECLARE
  spec TEXT[];
  specs TEXT[][] := ARRAY[
    ARRAY['warehouses', 'code'], ARRAY['warehouses', 'name'],
    ARRAY['product_groups', 'code'], ARRAY['product_groups', 'name'],
    ARRAY['products', 'code'], ARRAY['products', 'name'], ARRAY['products', 'unit'],
    ARRAY['partners', 'code'], ARRAY['partners', 'name'], ARRAY['partners', 'address'],
    ARRAY['partners', 'phone'], ARRAY['partners', 'tax_code'],
    ARRAY['cash_accounts', 'code'], ARRAY['cash_accounts', 'name'],
    ARRAY['partner_prices', 'note']];
  r RECORD;
BEGIN
  IF getdatabaseencoding() <> 'UTF8' THEN
    RETURN;
  END IF;
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    FOR r IN EXECUTE format('SELECT ctid AS c FROM %I WHERE %I IS NOT NFC NORMALIZED', spec[1], spec[2]) LOOP
      BEGIN
        EXECUTE format('UPDATE %I SET %I = normalize(%I, NFC) WHERE ctid = $1', spec[1], spec[2], spec[2]) USING r.c;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END LOOP;
END $$;
