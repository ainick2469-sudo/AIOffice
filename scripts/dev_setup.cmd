@echo off
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\dev_setup.ps1"
exit /b %ERRORLEVEL%

