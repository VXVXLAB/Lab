#!/usr/bin/env bash
# CÀI ĐẶT / NÂNG CẤP Phần mềm Quản lý kho trên Ubuntu / Debian (có systemd). Chạy:  sudo ./cai-dat.sh
# Chạy lại trên máy đã cài = nâng cấp (sao lưu trước, giữ nguyên dữ liệu).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Hãy chạy bằng sudo."; exit 1; }
GOI="$(cd "$(dirname "$0")" && pwd)"
DIR=/opt/kho; ENVF=$DIR/kho.env; CONG=8080
[ -x "$GOI/app/khoserver" ] || { echo "Bộ cài thiếu app/khoserver"; exit 1; }

chep() {
  mkdir -p $DIR/sao-luu
  install -m 755 "$GOI/app/khoserver" $DIR/khoserver.moi && mv -f $DIR/khoserver.moi $DIR/khoserver
  rm -rf $DIR/giao-dien && cp -r "$GOI/app/giao-dien" $DIR/giao-dien
  install -m 755 "$GOI/lenh/sao-luu.sh" "$GOI/lenh/khoi-phuc.sh" $DIR/
}
cho_web() { for _ in $(seq 60); do curl -fsS -o /dev/null "http://127.0.0.1:$CONG/" && return 0; sleep 1; done; return 1; }

if [ -f $ENVF ]; then
  echo "== Máy đã cài => NÂNG CẤP"
  set -a; . $ENVF; set +a
  $DIR/sao-luu.sh $DIR/sao-luu
  systemctl stop kho; chep; systemctl start kho
  cho_web || { echo "LỖI: phần mềm chưa lên. Xem: journalctl -u kho -n 50"; exit 1; }
  echo "Đã nâng cấp. Các máy kế toán bấm Ctrl+F5."; exit 0
fi

echo "== CÀI MỚI vào $DIR"
MK=""; while [ ${#MK} -lt 6 ]; do read -r -s -p 'Đặt mật khẩu tài khoản quản trị "admin" (ít nhất 6 ký tự): ' MK; echo; done
echo "== 1/5 Cài PostgreSQL"
command -v psql >/dev/null || { apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql curl; }
systemctl enable --now postgresql
echo "== 2/5 Tạo cơ sở dữ liệu"
PW=$(tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 24)
su postgres -c "psql -v ON_ERROR_STOP=1 -qc \"CREATE ROLE kho LOGIN PASSWORD '$PW'\""
su postgres -c "psql -v ON_ERROR_STOP=1 -qc \"CREATE DATABASE kho OWNER kho ENCODING 'UTF8' TEMPLATE template0\""
echo "== 3/5 Chép chương trình và cấu hình"
id kho >/dev/null 2>&1 || useradd --system --home $DIR --shell /usr/sbin/nologin kho
chep
cat > $ENVF <<CFG
# Cấu hình Phần mềm Quản lý kho. Sửa xong: sudo systemctl restart kho
DATABASE_URL=postgres://kho:$PW@127.0.0.1:5432/kho
LISTEN_ADDR=:$CONG
ADMIN_PASSWORD=$MK
CFG
chown -R kho:kho $DIR; chmod 600 $ENVF
echo "== 4/5 Tự chạy khi bật máy + sao lưu hằng ngày"
cat > /etc/systemd/system/kho.service <<UNIT
[Unit]
Description=Phan mem Quan ly kho
After=network.target postgresql.service
Wants=postgresql.service
[Service]
User=kho
WorkingDirectory=$DIR
ExecStart=$DIR/khoserver
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/cron.d/kho-sao-luu <<CRON
# Sao lưu 12:15 và 18:30 hằng ngày. Đổi /opt/kho/sao-luu thành ổ ngoài nếu có.
15 12 * * * kho . $ENVF; export DATABASE_URL; $DIR/sao-luu.sh $DIR/sao-luu >> $DIR/sao-luu.log 2>&1
30 18 * * * kho . $ENVF; export DATABASE_URL; $DIR/sao-luu.sh $DIR/sao-luu >> $DIR/sao-luu.log 2>&1
CRON
systemctl daemon-reload; systemctl enable --now kho
echo "== 5/5 Kiểm tra"
cho_web || { echo "LỖI: phần mềm chưa lên. Xem: journalctl -u kho -n 50"; exit 1; }
sed -i '/^ADMIN_PASSWORD=/d' $ENVF
command -v ufw >/dev/null && ufw status | grep -q "Status: active" && ufw allow $CONG/tcp >/dev/null || true
echo; echo "==================== CÀI ĐẶT XONG ===================="
for ip in $(hostname -I); do echo "Các máy kế toán mở:  http://$ip:$CONG"; done
echo "Đăng nhập: admin / mật khẩu vừa đặt. Sao lưu tự động vào $DIR/sao-luu — hãy chép thêm ra ổ ngoài."
