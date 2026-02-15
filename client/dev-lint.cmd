@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
npm run lint
exit /b %ERRORLEVEL%
