@echo off
rem Restarts MOTUS.
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run as Administrator: right-click Restart-Motus.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Control.ps1" restart
set RC=%ERRORLEVEL%
pause
exit /b %RC%
