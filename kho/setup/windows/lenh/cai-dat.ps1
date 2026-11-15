# CÀI ĐẶT / NÂNG CẤP Phần mềm Quản lý kho trên Windows 10/11 hoặc Windows Server (64-bit).
# Chạy qua CAI-DAT.bat (tự xin quyền Administrator). Chạy lại trên máy đã cài = nâng cấp, dữ liệu giữ nguyên.
. (Join-Path $PSScriptRoot 'chung.ps1')
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$GoiDir  = Split-Path $PSScriptRoot -Parent          # thư mục bộ cài
$PgZipTen = 'postgresql-16.6-1-windows-x64-binaries.zip'
$PgUrl    = "https://get.enterprisedb.com/postgresql/$PgZipTen"
$VcUrl    = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
$Cong     = 8080

function Chep-Chuong-Trinh {
  New-Item -ItemType Directory -Force -Path $KhoDir | Out-Null
  Copy-Item -Force (Join-Path $GoiDir 'app\khoserver.exe') $KhoDir
  $gd = Join-Path $KhoDir 'giao-dien'
  if (Test-Path $gd) { Remove-Item -Recurse -Force $gd }
  Copy-Item -Recurse -Force (Join-Path $GoiDir 'app\giao-dien') $gd
  foreach ($f in 'chung.ps1', 'sao-luu.ps1', 'khoi-phuc.ps1', 'go-bo.ps1', 'chay-khoserver.bat') {
    Copy-Item -Force (Join-Path $PSScriptRoot $f) $KhoDir
  }
  Copy-Item -Force (Join-Path $GoiDir 'HUONG-DAN-CAI-DAT.txt') $KhoDir -ErrorAction SilentlyContinue
}

function Dang-Ky-Tac-Vu {
  $st = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  $pr = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $a1 = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$KhoDir\chay-khoserver.bat`"" -WorkingDirectory $KhoDir
  Register-ScheduledTask -TaskName $TaskApp -Action $a1 -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $st -Principal $pr -Force | Out-Null
  $st2 = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  $a2 = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$KhoDir\sao-luu.ps1`""
  $tg = @((New-ScheduledTaskTrigger -Daily -At '12:15'), (New-ScheduledTaskTrigger -Daily -At '18:30'))
  Register-ScheduledTask -TaskName $TaskBak -Action $a2 -Trigger $tg -Settings $st2 -Principal $pr -Force | Out-Null
}

function Ket-Thuc-Thanh-Cong {
  $ips = @(Dia-Chi-LAN)
  try {
    $lnk = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Quan ly kho.url'
    Set-Content -Path $lnk -Value "[InternetShortcut]`r`nURL=http://localhost:$Cong/" -Encoding ASCII
  } catch {}
  Write-Host ''
  Viet '==================== CÀI ĐẶT XONG ====================' 'Green'
  Viet "Trên máy này mở:        http://localhost:$Cong   (đã tạo biểu tượng 'Quan ly kho' trên màn hình)"
  foreach ($ip in $ips) { Viet "Các máy kế toán mở:     http://${ip}:$Cong" }
  Viet 'Dùng Chrome hoặc Edge. Các máy kế toán KHÔNG cần cài gì.'
  Viet "Sao lưu tự động 12:15 và 18:30 hằng ngày vào $BakDir"
  Viet 'QUAN TRỌNG: mở C:\KhoApp\kho.env, đặt SAO_LUU_THU_MUC_2=<ổ USB / NAS / thư mục đồng bộ> để có bản sao ngoài máy này.' 'Yellow'
  Viet 'Nên đặt IP tĩnh cho máy này để địa chỉ trên không đổi.' 'Yellow'
}

try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Cần Windows 64-bit.' }
  if (-not (Test-Path (Join-Path $GoiDir 'app\khoserver.exe'))) { throw 'Bộ cài thiếu app\khoserver.exe - hãy giải nén TOÀN BỘ file zip rồi chạy lại.' }

  # ---------------- NÂNG CẤP ----------------
  if ((Test-Path (Join-Path $DataDir 'PG_VERSION')) -and (Test-Path $EnvFile)) {
    Viet 'Máy này đã cài phần mềm => NÂNG CẤP (dữ liệu giữ nguyên).' 'Yellow'
    Buoc '1/4 Sao lưu trước khi nâng cấp'
    & (Join-Path $KhoDir 'sao-luu.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Sao lưu thất bại - dừng nâng cấp để an toàn.' }
    Buoc '2/4 Dừng phần mềm'
    Dung-KhoServer
    Buoc '3/4 Chép phiên bản mới'
    Chep-Chuong-Trinh
    Dang-Ky-Tac-Vu
    Buoc '4/4 Bật lại'
    Chay-KhoServer
    if (-not (Cho-Web $Cong 90)) { throw "Phần mềm chưa lên sau 90 giây. Xem $KhoDir\kho.log" }
    Ket-Thuc-Thanh-Cong
    Viet 'Các máy kế toán bấm Ctrl+F5 một lần để nhận giao diện mới.'
    exit 0
  }

  # ---------------- CÀI MỚI ----------------
  Viet 'CÀI ĐẶT MỚI Phần mềm Quản lý kho vào C:\KhoApp' 'Green'
  if (Test-Path $DataDir) { throw "Đã có thư mục $DataDir nhưng không đầy đủ. Đổi tên/xóa thư mục C:\KhoApp cũ rồi chạy lại." }
  if (Get-NetTCPConnection -LocalPort $Cong -State Listen -ErrorAction SilentlyContinue) { throw "Cổng $Cong đang có chương trình khác dùng." }
  if (Get-NetTCPConnection -LocalPort $PgPort -State Listen -ErrorAction SilentlyContinue) { throw "Cổng $PgPort đang có chương trình khác dùng." }

  $mk = ''
  while ($mk.Length -lt 6) { $mk = Read-Host 'Đặt mật khẩu cho tài khoản quản trị "admin" (ít nhất 6 ký tự, không dấu)' }

  Buoc '1/7 Chép chương trình'
  Chep-Chuong-Trinh

  Buoc '2/7 Chuẩn bị PostgreSQL (cơ sở dữ liệu)'
  if (-not (Test-Path (Join-Path $PgBin 'postgres.exe'))) {
    $zip = Join-Path $GoiDir $PgZipTen
    if (-not (Test-Path $zip)) {
      Viet "Đang tải PostgreSQL (~300 MB) từ $PgUrl ..."
      Viet '(Máy không có mạng: tải file đó ở máy khác, đặt cạnh CAI-DAT.bat rồi chạy lại.)'
      Invoke-WebRequest -Uri $PgUrl -OutFile "$zip.tai" -UseBasicParsing
      Move-Item -Force "$zip.tai" $zip
    }
    Viet 'Đang giải nén...'
    Expand-Archive -Path $zip -DestinationPath $KhoDir -Force     # tạo C:\KhoApp\pgsql
    if (-not (Test-Path (Join-Path $PgBin 'postgres.exe'))) { throw 'Giải nén PostgreSQL không ra thư mục pgsql\bin.' }
  }
  if (-not (Test-Path "$env:WINDIR\System32\vcruntime140.dll")) {
    Viet 'Thiếu Microsoft Visual C++ Runtime, đang tải và cài...'
    $vc = Join-Path $env:TEMP 'vc_redist.x64.exe'
    Invoke-WebRequest -Uri $VcUrl -OutFile $vc -UseBasicParsing
    Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Wait
  }

  Buoc '3/7 Tạo cơ sở dữ liệu'
  $pwSuper = Mat-Khau-Ngau-Nhien
  $pwKho   = Mat-Khau-Ngau-Nhien
  $pwFile  = Join-Path $KhoDir 'pw.tmp'
  [IO.File]::WriteAllText($pwFile, $pwSuper, (New-Object Text.UTF8Encoding($false)))
  try {
    Chay (Join-Path $PgBin 'initdb.exe') @('-D', $DataDir, '-U', 'postgres', '-A', 'scram-sha-256', "--pwfile=$pwFile", '-E', 'UTF8', '--locale=C')
  } finally { Remove-Item -Force $pwFile -ErrorAction SilentlyContinue }
  Add-Content -Path (Join-Path $DataDir 'postgresql.conf') -Encoding ASCII -Value @(
    '', '# --- Phan mem Quan ly kho ---', "port = $PgPort", "listen_addresses = '127.0.0.1'", "timezone = 'Asia/Ho_Chi_Minh'")
  # Dịch vụ PostgreSQL chạy bằng tài khoản NetworkService: cấp quyền trên thư mục dữ liệu và chương trình.
  Chay 'icacls.exe' @($DataDir, '/grant', '*S-1-5-20:(OI)(CI)F', '/T', '/Q')
  Chay 'icacls.exe' @($PgDir, '/grant', '*S-1-5-20:(OI)(CI)RX', '/T', '/Q')
  Chay (Join-Path $PgBin 'pg_ctl.exe') @('register', '-N', $PgSvc, '-D', $DataDir, '-S', 'auto', '-w')
  Start-Service $PgSvc
  $ok = $false
  for ($i = 0; $i -lt 60; $i++) {
    & (Join-Path $PgBin 'pg_isready.exe') -h 127.0.0.1 -p $PgPort | Out-Null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ok) { throw "PostgreSQL không khởi động được. Xem Event Viewer > Application, nguồn 'PostgreSQL'." }
  $env:PGPASSWORD = $pwSuper
  try {
    $psql = Join-Path $PgBin 'psql.exe'
    Chay $psql @('-h', '127.0.0.1', '-p', "$PgPort", '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', "CREATE ROLE kho LOGIN PASSWORD '$pwKho'")
    Chay $psql @('-h', '127.0.0.1', '-p', "$PgPort", '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-c', "CREATE DATABASE kho OWNER kho ENCODING 'UTF8' TEMPLATE template0")
  } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

  Buoc '4/7 Ghi cấu hình'
  $cauHinh = @(
    '# Cấu hình Phần mềm Quản lý kho. Sửa xong phải khởi động lại: Stop-ScheduledTask KhoServer; Start-ScheduledTask KhoServer',
    "DATABASE_URL=postgres://kho:$pwKho@127.0.0.1:$PgPort/kho",
    "LISTEN_ADDR=:$Cong",
    "LOG_FILE=$KhoDir\kho.log",
    "ADMIN_PASSWORD=$mk",
    '# Thư mục thứ hai để chép bản sao lưu (ổ USB, NAS, thư mục đồng bộ đám mây). NÊN ĐẶT. Ví dụ: SAO_LUU_THU_MUC_2=E:\SaoLuuKho',
    'SAO_LUU_THU_MUC_2=',
    'SAO_LUU_GIU_NGAY=30',
    "# Mật khẩu quản trị PostgreSQL (tài khoản postgres), chỉ dùng khi cần can thiệp kỹ thuật: $pwSuper"
  )
  Set-Content -Path $EnvFile -Value $cauHinh -Encoding UTF8
  # Chỉ quản trị máy và SYSTEM đọc được file cấu hình (có mật khẩu).
  Chay 'icacls.exe' @($EnvFile, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '*S-1-5-18:F', '/Q')

  Buoc '5/7 Đăng ký tự chạy khi bật máy và sao lưu hằng ngày'
  Dang-Ky-Tac-Vu

  Buoc '6/7 Mở tường lửa cho mạng nội bộ'
  try {
    Remove-NetFirewallRule -DisplayName 'Phan mem Quan ly kho' -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName 'Phan mem Quan ly kho' -Direction Inbound -Protocol TCP -LocalPort $Cong -Action Allow -Profile Private, Domain | Out-Null
  } catch { Viet "Không tự mở được tường lửa: $($_.Exception.Message). Hãy mở cổng $Cong bằng tay." 'Yellow' }

  Buoc '7/7 Khởi động phần mềm'
  Chay-KhoServer
  if (-not (Cho-Web $Cong 90)) { throw "Phần mềm chưa lên sau 90 giây. Xem $KhoDir\kho.log" }
  # Mật khẩu admin chỉ cần cho lần chạy đầu: xóa khỏi file cấu hình.
  (Get-Content $EnvFile -Encoding UTF8) | Where-Object { $_ -notlike 'ADMIN_PASSWORD=*' } | Set-Content $EnvFile -Encoding UTF8
  & (Join-Path $KhoDir 'sao-luu.ps1') | Out-Null

  Ket-Thuc-Thanh-Cong
  Viet 'Đăng nhập: tài khoản admin, mật khẩu vừa đặt. Làm theo màn hình "Bắt đầu sử dụng".'
  Viet 'Nếu mạng văn phòng đang để kiểu "Public", các máy khác sẽ không vào được: đổi mạng sang "Private" trong Settings > Network.' 'Yellow'
} catch {
  Write-Host ''
  Loi $_.Exception.Message
  Viet 'Cài đặt CHƯA xong. Chụp màn hình này gửi người hỗ trợ.' 'Yellow'
  exit 1
}
