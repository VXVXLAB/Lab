@echo off
rem Cai dat / nang cap Phan mem Quan ly kho. Bam dup vao file nay.
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Dang xin quyen quan tri Administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lenh\cai-dat.ps1"
echo.
pause
