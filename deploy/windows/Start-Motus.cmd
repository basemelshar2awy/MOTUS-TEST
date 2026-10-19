@echo off
rem Starts MOTUS (also starts automatically at boot).
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Run as Administrator: right-click Start-Motus.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Control.ps1" start
set RC=%ERRORLEVEL%
pause
exit /b %RC%
