@echo off
cd /d "%~dp0"
call "%~dp0desktop-launch.cmd"
exit /b %ERRORLEVEL%
