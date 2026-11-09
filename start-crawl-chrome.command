#!/bin/bash
# Chrome for Facebook research (crawl-fb.mjs): its own profile, a control port on 127.0.0.1:9222. Sign in to the
# secondary Facebook account once in this window; cookies stay in this Chrome profile, never in the tool.
PROFILE="$HOME/Library/Application Support/social-autopilot-chrome"
if curl -s --max-time 2 http://127.0.0.1:9222/json/version >/dev/null; then echo "Crawl Chrome is already running on port 9222."; exit 0; fi
# A Chrome with this profile but without the port: a new launch would only open a window in it and the port would never open.
if pgrep -f "social-autopilot-chrome" >/dev/null; then echo "A Chrome window with the crawl profile is open without the control port. Quit that Chrome, then run this again."; read -r -p "Press Enter to close."; exit 1; fi
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$PROFILE" https://www.facebook.com/
# The port must answer within a few seconds; otherwise a Chrome with this profile was already open without it.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s --max-time 1 http://127.0.0.1:9222/json/version >/dev/null; then echo "Crawl Chrome is running on port 9222."; exit 0; fi
  sleep 0.5
done
echo "The control port 9222 did not open. A Chrome window with the crawl profile is probably already open without it: quit that Chrome, then run this again."
read -r -p "Press Enter to close."
exit 1
