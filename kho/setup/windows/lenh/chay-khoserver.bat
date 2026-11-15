@echo off
rem Chay khoserver va tu chay lai neu no dung (vi du CSDL chua kip khoi dong luc bat may).
cd /d "%~dp0"
:lap
khoserver.exe
timeout /t 5 /nobreak >nul
goto lap
