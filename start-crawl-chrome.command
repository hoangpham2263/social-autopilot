#!/bin/bash
# Chrome for Facebook research (crawl-fb.mjs): its own profile, a control port on 127.0.0.1:9222. Sign in to the
# secondary Facebook account once in this window; cookies stay in this Chrome profile, never in the tool.
PROFILE="$HOME/Library/Application Support/social-autopilot-chrome"
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$PROFILE" https://www.facebook.com/
