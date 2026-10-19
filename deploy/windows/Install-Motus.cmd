@echo off
rem MOTUS one-click installation - right-click, "Run as administrator".
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo This must be run as Administrator: right-click Install-Motus.cmd and choose "Run as administrator".
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Motus.ps1" %*
set RC=%ERRORLEVEL%
if not "%RC%"=="0" echo. & echo Installation stopped. Read the message above, fix it, then run this file again.
pause
exit /b %RC%
