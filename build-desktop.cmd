@echo off
cd /d "%~dp0"
call "%~dp0with-runtime.cmd" python tools\build_desktop_exe.py %*
if %ERRORLEVEL% EQU 9009 call "%~dp0with-runtime.cmd" py -3 tools\build_desktop_exe.py %*
exit /b %ERRORLEVEL%
