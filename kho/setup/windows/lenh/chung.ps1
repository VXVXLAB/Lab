# Hàm dùng chung cho các lệnh cài đặt / sao lưu / khôi phục.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$KhoDir   = 'C:\KhoApp'
$PgDir    = Join-Path $KhoDir 'pgsql'
$PgBin    = Join-Path $PgDir 'bin'
$DataDir  = Join-Path $KhoDir 'du-lieu'
$BakDir   = Join-Path $KhoDir 'sao-luu'
$EnvFile  = Join-Path $KhoDir 'kho.env'
$PgSvc    = 'KhoPostgreSQL'
$PgPort   = 5433
$TaskApp  = 'KhoServer'
$TaskBak  = 'KhoSaoLuu'

function Viet([string]$s, [string]$mau = 'Gray') { Write-Host $s -ForegroundColor $mau }
function Buoc([string]$s) { Write-Host ''; Write-Host "== $s" -ForegroundColor Cyan }
function Loi([string]$s)  { Write-Host "LỖI: $s" -ForegroundColor Red }

function Doc-Env {
  $h = @{}
  if (Test-Path $EnvFile) {
    foreach ($l in Get-Content $EnvFile -Encoding UTF8) {
      $l = $l.Trim()
      if ($l -eq '' -or $l.StartsWith('#')) { continue }
      $i = $l.IndexOf('=')
      if ($i -gt 0) { $h[$l.Substring(0, $i).Trim()] = $l.Substring($i + 1).Trim() }
    }
  }
  return $h
}

function Mat-Khau-Ngau-Nhien([int]$n = 20) {
  $c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $b = New-Object byte[] $n
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $c[$_ % $c.Length] })
}

# Chạy một chương trình ngoài, báo lỗi nếu mã thoát khác 0.
function Chay([string]$exe, [string[]]$thamSo) {
  & $exe @thamSo
  if ($LASTEXITCODE -ne 0) { throw "Lệnh thất bại (mã $LASTEXITCODE): $exe $($thamSo -join ' ')" }
}

function Dung-KhoServer {
  try { Stop-ScheduledTask -TaskName $TaskApp -ErrorAction SilentlyContinue } catch {}
  Get-Process khoserver -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

function Chay-KhoServer { Start-ScheduledTask -TaskName $TaskApp }

function Cho-Web([int]$cong, [int]$giay = 60) {
  for ($i = 0; $i -lt $giay; $i++) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$cong/" -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

function Dia-Chi-LAN {
  try {
    Get-NetIPAddress -AddressFamily IPv4 |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
      Select-Object -ExpandProperty IPAddress
  } catch { @() }
}
