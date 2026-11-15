# Khôi phục dữ liệu từ một file sao lưu. XÓA SẠCH dữ liệu hiện có rồi nạp lại từ file.
#   Cách dùng (PowerShell quyền Administrator):  C:\KhoApp\khoi-phuc.ps1 C:\KhoApp\sao-luu\kho-20261115-121500.dump
param([Parameter(Mandatory = $true)][string]$File)
. (Join-Path $PSScriptRoot 'chung.ps1')
try {
  if (-not (Test-Path $File)) { throw "Không thấy file $File" }
  $cfg = Doc-Env
  $db = $cfg['DATABASE_URL']
  if (-not $db) { throw 'Không thấy DATABASE_URL trong kho.env' }
  & (Join-Path $PgBin 'pg_restore.exe') --list $File | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'File sao lưu hỏng, không khôi phục.' }
  Viet "Sẽ XÓA toàn bộ dữ liệu hiện có và nạp lại từ: $File" 'Yellow'
  Viet 'Dữ liệu nhập sau thời điểm sao lưu sẽ không còn.' 'Yellow'
  $a = Read-Host 'Gõ CO rồi Enter để tiếp tục'
  if ($a -ne 'CO') { Viet 'Đã hủy.'; exit 1 }
  Buoc 'Sao lưu hiện trạng trước khi khôi phục (phòng khi chọn nhầm file)'
  & (Join-Path $PSScriptRoot 'sao-luu.ps1')
  Buoc 'Dừng phần mềm'
  Dung-KhoServer
  Buoc 'Nạp lại dữ liệu'
  Chay (Join-Path $PgBin 'psql.exe') @($db, '-v', 'ON_ERROR_STOP=1', '-q', '-c', 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;')
  Chay (Join-Path $PgBin 'pg_restore.exe') @('--no-owner', '--no-privileges', '--exit-on-error', "--dbname=$db", $File)
  Buoc 'Bật lại phần mềm'
  Chay-KhoServer
  Viet 'Đã khôi phục xong.' 'Green'
} catch {
  Loi $_.Exception.Message
  Viet 'Nếu phần mềm đang tắt, bật lại bằng: Start-ScheduledTask KhoServer'
  exit 1
}
