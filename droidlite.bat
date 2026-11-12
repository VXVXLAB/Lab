@echo off
rem Mo bang dieu khien DroidLite (can Python 3.9 tro len).
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py -3 -m droidlite %*) else (python -m droidlite %*)
if errorlevel 1 pause
