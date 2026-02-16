@echo off
cd /d "%~dp0"
call "%~dp0with-runtime.cmd" C:\Users\nickb\AppData\Local\Programs\Python\Python312\python.exe tools\build_desktop_exe.py %*
exit /b %ERRORLEVEL%
