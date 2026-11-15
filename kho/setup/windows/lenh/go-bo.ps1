# Gỡ phần mềm: dừng và xóa dịch vụ, tác vụ tự chạy, luật tường lửa. GIỮ LẠI C:\KhoApp\du-lieu và C:\KhoApp\sao-luu.
. (Join-Path $PSScriptRoot 'chung.ps1')
Viet 'Gỡ bỏ Phần mềm Quản lý kho. Dữ liệu (C:\KhoApp\du-lieu) và bản sao lưu (C:\KhoApp\sao-luu) được GIỮ LẠI.' 'Yellow'
$a = Read-Host 'Gõ CO rồi Enter để gỡ'
if ($a -ne 'CO') { Viet 'Đã hủy.'; exit 0 }
try { if (Test-Path (Join-Path $KhoDir 'sao-luu.ps1')) { & (Join-Path $KhoDir 'sao-luu.ps1') } } catch {}
Dung-KhoServer
foreach ($t in @($TaskApp, $TaskBak)) { try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {} }
try { Stop-Service $PgSvc -ErrorAction SilentlyContinue } catch {}
if (Test-Path (Join-Path $PgBin 'pg_ctl.exe')) { & (Join-Path $PgBin 'pg_ctl.exe') unregister -N $PgSvc | Out-Null }
try { Remove-NetFirewallRule -DisplayName 'Phan mem Quan ly kho' -ErrorAction SilentlyContinue } catch {}
try { Remove-Item (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Quan ly kho.url') -ErrorAction SilentlyContinue } catch {}
Viet 'Đã gỡ. Muốn xóa hẳn dữ liệu thì tự xóa thư mục C:\KhoApp (KHÔNG khôi phục được).' 'Green'
