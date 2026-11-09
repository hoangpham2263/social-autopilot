@echo off
rem Rebuilds dashboard.html from the current data (read-only) and opens it in the default browser.
cd /d "%~dp0"
node scripts\dashboard.mjs >nul
if errorlevel 1 (
  node scripts\dashboard.mjs
  pause
  exit /b 1
)
start "" "%~dp0dashboard.html"
