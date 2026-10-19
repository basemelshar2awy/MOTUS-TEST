@echo off
rem Makes a database backup now.
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run as Administrator: right-click Backup-Motus.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Backup-Database.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
