@echo off
rem Chrome for Facebook research (crawl-fb.mjs): its own profile, a control port on 127.0.0.1:9222. Sign in to the
rem secondary Facebook account once in this window; cookies stay in this Chrome profile, never in the tool.
set "PROFILE=%LOCALAPPDATA%\social-autopilot-chrome"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (echo Google Chrome not found. & pause & exit /b 1)
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" https://www.facebook.com/
