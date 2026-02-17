@echo off
setlocal
set "SYSROOT=%SystemRoot%"
if "%SYSROOT%"=="" set "SYSROOT=C:\Windows"
set "PY_LOCAL=%LocalAppData%\Programs\Python"
set "PATH=%SYSROOT%\System32;%SYSROOT%;%ProgramFiles%\Git\cmd;%ProgramFiles%\Git\bin;%ProgramFiles(x86)%\Git\cmd;%ProgramFiles%\nodejs;%PY_LOCAL%\Python313;%PY_LOCAL%\Python313\Scripts;%PY_LOCAL%\Python312;%PY_LOCAL%\Python312\Scripts;%PATH%"
cd /d "%~dp0"
%*
exit /b %ERRORLEVEL%
