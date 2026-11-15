#!/usr/bin/env bash
# CẤU HÌNH HTTPS + TÊN MIỀN cho máy chủ ĐÃ CÀI Phần mềm Quản lý kho (bằng cai-dat.sh).
#   sudo ./cau-hinh-https.sh inhanh.net
# Làm gì: phần mềm chỉ nghe nội bộ máy (127.0.0.1) -> Caddy đứng trước lo HTTPS (chứng thư tự cấp, tự gia hạn)
#         -> tường lửa chỉ mở 22, 80, 443. Chạy lại nhiều lần không sao. Không đụng tới dữ liệu.
set -euo pipefail
trap 'echo; echo "LỖI: dừng ở dòng $LINENO (lệnh: $BASH_COMMAND). Chụp màn hình này gửi người hỗ trợ."' ERR

TEN_MIEN="${1:-}"
DIR=/opt/kho; ENVF=$DIR/kho.env
buoc() { echo; echo "== $*"; }

[ "$(id -u)" = 0 ] || { echo "Hãy chạy bằng sudo."; exit 1; }
[ -n "$TEN_MIEN" ] || { echo "Cách dùng: sudo ./cau-hinh-https.sh <tên-miền>   (ví dụ: sudo ./cau-hinh-https.sh inhanh.net)"; exit 1; }
case "$TEN_MIEN" in *[!a-zA-Z0-9.-]*|.*|*.|-*) echo "Tên miền không hợp lệ: $TEN_MIEN"; exit 1;; esac
[ -f "$ENVF" ] || { echo "Chưa thấy $ENVF — hãy cài phần mềm trước bằng cai-dat.sh."; exit 1; }

# Cổng phần mềm đang dùng (mặc định 8080)
CONG=$(sed -n 's/^LISTEN_ADDR=.*:\([0-9][0-9]*\)$/\1/p' "$ENVF" | tail -n 1)
[ -n "$CONG" ] || CONG=8080
IP_MAY=$(hostname -I | awk '{print $1}')

buoc "1/6 Kiểm tra tên miền $TEN_MIEN đã trỏ về máy chủ này ($IP_MAY) chưa"
IP_TM=$(getent ahostsv4 "$TEN_MIEN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -z "$IP_TM" ]; then
  echo "CẢNH BÁO: chưa tra được tên miền $TEN_MIEN. Hãy tạo bản ghi A: $TEN_MIEN -> $IP_MAY ở nơi quản lý tên miền."
  echo "          Script vẫn cấu hình tiếp; khi tên miền có hiệu lực, chạy: sudo systemctl restart caddy"
elif [ "$IP_TM" != "$IP_MAY" ]; then
  echo "CẢNH BÁO: $TEN_MIEN đang trỏ về $IP_TM, không phải $IP_MAY (nếu máy chủ nằm sau NAT thì có thể vẫn đúng)."
  echo "          Nếu sai, sửa bản ghi A rồi chạy: sudo systemctl restart caddy"
else
  echo "Đúng: $TEN_MIEN -> $IP_TM"
fi

buoc "2/6 Kiểm tra cổng 80 và 443 có chương trình khác chiếm không"
BAN=$(ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/' | grep -v caddy || true)
if [ -n "$BAN" ]; then
  echo "$BAN"
  echo "LỖI: cổng 80/443 đang do chương trình khác dùng (thường là nginx hoặc apache). Tắt/gỡ nó rồi chạy lại,"
  echo "     ví dụ: sudo systemctl disable --now nginx   hoặc   sudo systemctl disable --now apache2"
  exit 1
fi
echo "Trống."

buoc "3/6 Cho phần mềm chỉ nghe trong nội bộ máy (127.0.0.1:$CONG) và bật cookie an toàn"
cp -p "$ENVF" "$ENVF.truoc-https" 2>/dev/null || true
if grep -q '^LISTEN_ADDR=' "$ENVF"; then
  sed -i "s/^LISTEN_ADDR=.*/LISTEN_ADDR=127.0.0.1:$CONG/" "$ENVF"
else
  echo "LISTEN_ADDR=127.0.0.1:$CONG" >> "$ENVF"
fi
if grep -q '^COOKIE_SECURE=' "$ENVF"; then
  sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' "$ENVF"
else
  echo "COOKIE_SECURE=true" >> "$ENVF"
fi
systemctl restart kho
OK=0
for _ in $(seq 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$CONG/" 2>/dev/null; then OK=1; break; fi
  sleep 1
done
[ "$OK" = 1 ] || { echo "LỖI: phần mềm không lên sau khi khởi động lại. Xem: journalctl -u kho -n 40 --no-pager"; exit 1; }
echo "Phần mềm đang chạy ở 127.0.0.1:$CONG."

buoc "4/6 Cài và cấu hình Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy
fi
[ -f /etc/caddy/Caddyfile ] && cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.truoc-$(date +%Y%m%d-%H%M%S)"
cat > /etc/caddy/Caddyfile <<CADDY
# Phan mem Quan ly kho - HTTPS phia truoc; khoserver chi nghe 127.0.0.1:$CONG
$TEN_MIEN {
	encode gzip
	reverse_proxy 127.0.0.1:$CONG {
		flush_interval -1
	}
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
echo "Caddy đang chạy."

buoc "5/6 Tường lửa: chỉ mở 22 (SSH), 80, 443"
command -v ufw >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw
CONG_SSH=$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}' || true)
[ -n "$CONG_SSH" ] || CONG_SSH=22
ufw allow "$CONG_SSH"/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw delete allow "$CONG"/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

buoc "6/6 Kiểm tra https://$TEN_MIEN"
KQ=0
for _ in $(seq 20); do
  if curl -fsS -o /dev/null --resolve "$TEN_MIEN:443:127.0.0.1" "https://$TEN_MIEN/" 2>/dev/null; then KQ=1; break; fi
  sleep 3
done
echo
if [ "$KQ" = 1 ]; then
  echo "==================== XONG ===================="
  echo "Mở phần mềm tại:  https://$TEN_MIEN"
else
  echo "==================== ĐÃ CẤU HÌNH, NHƯNG CHƯA CÓ CHỨNG THƯ HTTPS ===================="
  echo "Thường do tên miền chưa trỏ về máy chủ này, hoặc nhà cung cấp máy chủ còn chặn cổng 80/443 ở tường lửa riêng."
  echo "Sửa xong chạy: sudo systemctl restart caddy    Xem lỗi: journalctl -u caddy -n 30 --no-pager"
fi
echo "Địa chỉ cũ http://$IP_MAY:$CONG không còn vào được từ bên ngoài (đúng ý)."
echo "Cấu hình trước khi đổi được lưu ở $ENVF.truoc-https"
