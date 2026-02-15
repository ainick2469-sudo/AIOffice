@echo off
setlocal
set "PATH=C:\Windows\System32;C:\Windows;C:\Program Files\nodejs;C:\Users\nickb\AppData\Local\Programs\Python\Python312;%PATH%"
cd /d "%~dp0"
%*
exit /b %ERRORLEVEL%
