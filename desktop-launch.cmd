@echo off
cd /d "%~dp0"
call "%~dp0with-runtime.cmd" python app.py
if %ERRORLEVEL% EQU 9009 call "%~dp0with-runtime.cmd" py -3 app.py
exit /b %ERRORLEVEL%
