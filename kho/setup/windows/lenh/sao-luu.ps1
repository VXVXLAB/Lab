# Sao lưu toàn bộ dữ liệu ra C:\KhoApp\sao-luu (và thư mục thứ hai nếu có đặt SAO_LUU_THU_MUC_2 trong kho.env).
# Được Windows chạy tự động mỗi ngày 12:15 và 18:30; cũng có thể bấm chạy tay.
. (Join-Path $PSScriptRoot 'chung.ps1')
$log = Join-Path $KhoDir 'sao-luu.log'
function Ghi([string]$s) { $d = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $s"; Add-Content -Path $log -Value $d -Encoding UTF8; Write-Host $d }
try {
  $cfg = Doc-Env
  if (-not $cfg['DATABASE_URL']) { throw 'Không thấy DATABASE_URL trong kho.env' }
  New-Item -ItemType Directory -Force -Path $BakDir | Out-Null
  $f   = Join-Path $BakDir ("kho-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $tmp = "$f.tmp"
  Chay (Join-Path $PgBin 'pg_dump.exe') @('--format=custom', '--no-owner', '--no-privileges', "--file=$tmp", $cfg['DATABASE_URL'])
  # Kiểm tra file đọc lại được rồi mới coi là xong.
  & (Join-Path $PgBin 'pg_restore.exe') --list $tmp | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'File sao lưu vừa tạo không đọc lại được' }
  Move-Item -Force $tmp $f
  $giu = 30; if ($cfg['SAO_LUU_GIU_NGAY']) { $giu = [int]$cfg['SAO_LUU_GIU_NGAY'] }
  Get-ChildItem $BakDir -Filter 'kho-*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$giu) } | Remove-Item -Force
  Ghi ("Đã sao lưu: $f ({0:N0} KB)" -f ((Get-Item $f).Length / 1KB))
  $d2 = $cfg['SAO_LUU_THU_MUC_2']
  if ($d2) {
    try {
      New-Item -ItemType Directory -Force -Path $d2 | Out-Null
      Copy-Item -Force $f $d2
      Get-ChildItem $d2 -Filter 'kho-*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$giu) } | Remove-Item -Force
      Ghi "Đã chép thêm sang: $d2"
    } catch { Ghi "CẢNH BÁO: không chép được sang $d2 : $($_.Exception.Message)" }
  } else {
    Ghi 'CẢNH BÁO: chưa đặt SAO_LUU_THU_MUC_2 trong kho.env - bản sao lưu đang nằm cùng ổ với dữ liệu.'
  }
} catch {
  Ghi "LỖI SAO LƯU: $($_.Exception.Message)"
  exit 1
}
