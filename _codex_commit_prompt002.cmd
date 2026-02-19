@echo off
setlocal
C:\Progra~1\Git\cmd\git.exe -C C:\AI_WORKSPACE\ai-office add -A
if errorlevel 1 exit /b 1
C:\Progra~1\Git\cmd\git.exe -C C:\AI_WORKSPACE\ai-office commit -m "fix: enable resizable workspace split pane (no hardcoded ratio) + clean splitpane css"
if errorlevel 1 exit /b 1
C:\Progra~1\Git\cmd\git.exe -C C:\AI_WORKSPACE\ai-office push
exit /b %errorlevel%
