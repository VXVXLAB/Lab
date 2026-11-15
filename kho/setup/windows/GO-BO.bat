@echo off
rem Go bo phan mem (GIU LAI du lieu va cac ban sao luu).
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lenh\go-bo.ps1"
echo.
pause
