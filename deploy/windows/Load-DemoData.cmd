@echo off
rem Loads review companies with sample data (test servers only).
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run as Administrator: right-click Load-DemoData.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Load-DemoData.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
