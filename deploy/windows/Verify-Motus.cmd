@echo off
rem Runs the automated deployment verification.
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run as Administrator: right-click Verify-Motus.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp05-Verify-Deployment.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
