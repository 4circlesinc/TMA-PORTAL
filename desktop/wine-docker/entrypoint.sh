#!/bin/bash

Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
sleep 2
fluxbox >/dev/null 2>&1 &
x11vnc -display :0 -forever -shared -nopw -quiet -bg
websockify --web=/usr/share/novnc 8080 localhost:5900 >/dev/null 2>&1 &

# plain (non-wow64) wine builds ship a 32-bit `wine` that Rosetta can't run
WINE=$(command -v wine64 || command -v wine)

echo ">>> initializing wine prefix (first boot takes a minute)..."
"$WINE" wineboot --init >/tmp/wineboot.log 2>&1
wineserver -w
echo ">>> wine prefix ready, launching: $APP_EXE"

"$WINE" "$APP_EXE" --no-sandbox --disable-gpu --disable-dev-shm-usage >/tmp/app.log 2>&1
echo ">>> app exited with code $? — container stays up for inspection (logs: /tmp/app.log)"
sleep infinity
