@echo off
rem Chrome for Facebook research (crawl-fb.mjs): its own profile, a control port on 127.0.0.1:9222. Sign in to the
rem secondary Facebook account once in this window; cookies stay in this Chrome profile, never in the tool.
set "PROFILE=%LOCALAPPDATA%\social-autopilot-chrome"
rem Already running with the port: nothing to do.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:9222/json/version | Out-Null; exit 0 } catch { exit 1 }" && (echo Crawl Chrome is already running on port 9222. & exit /b 0)
rem A Chrome with this profile but without the port: a new launch would only open a window in it and the port would
rem never open. Ask to close it first.
set RUNNING=0
for /f "usebackq" %%n in (`powershell -NoProfile -Command "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*social-autopilot-chrome*' }).Count"`) do set RUNNING=%%n
if not "%RUNNING%"=="0" (echo A Chrome window with the crawl profile is open without the control port. Close every window of that Chrome, then run this again. & pause & exit /b 1)
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (echo Google Chrome not found. & pause & exit /b 1)
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" https://www.facebook.com/
