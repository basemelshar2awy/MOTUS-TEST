@echo off
rem Resets a user's password (locked-out administrator).
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run as Administrator: right-click Reset-Password.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reset-Password.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
