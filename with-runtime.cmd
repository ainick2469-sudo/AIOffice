@echo off
setlocal
set "SYSROOT=%SystemRoot%"
if "%SYSROOT%"=="" set "SYSROOT=C:\Windows"
set "PY_LOCAL=%LocalAppData%\Programs\Python"
rem Prefer Python 3.12 over 3.13 for this repo since our deps/tests are installed there.
set "PATH=%SYSROOT%\System32;%SYSROOT%;%ProgramFiles%\Git\cmd;%ProgramFiles%\Git\bin;%ProgramFiles(x86)%\Git\cmd;%ProgramFiles%\nodejs;%PY_LOCAL%\Python312;%PY_LOCAL%\Python312\Scripts;%PY_LOCAL%\Python313;%PY_LOCAL%\Python313\Scripts;%PATH%"
cd /d "%~dp0"
%*
exit /b %ERRORLEVEL%
