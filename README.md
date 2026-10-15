# Maple Track

A local browser tracker for MapleStory Classic EXP with an OBS Browser Source overlay.

## Capture through OBS

This prototype uses OBS's built-in obs-websocket screenshot request. The Lua script schedules a local request; the Node bridge asks OBS for a screenshot of the selected source and makes the latest image available to the dashboard. The bridge binds only to `127.0.0.1` and does not contact Twitch.

Requirements: OBS Studio 28 or newer, its built-in WebSocket server enabled, and Node.js 18 or newer.

1. In OBS, open **Tools → WebSocket Server Settings**, enable the server, and note its port (default `4455`) and password.
2. Start the bridge from this folder:

   ```sh
   OBS_WEBSOCKET_PASSWORD='your-OBS-password' node obs/maple-track-obs-bridge.js
   ```

   If you changed the OBS port, also set `OBS_WEBSOCKET_URL`, such as `ws://127.0.0.1:4456`.
3. In a second terminal, serve the dashboard from this folder:

   ```sh
   python3 -m http.server 8000 --bind 127.0.0.1
   ```

4. In OBS, open **Tools → Scripts**, add `obs/maple-track-capture.lua`, select the game capture source, and click **Start capture timer**. The interval defaults to 30 seconds.
5. Open `http://127.0.0.1:8000` in a browser to see the dashboard. Add `http://127.0.0.1:8000/index.html?overlay=1` to OBS as a Browser Source for the tracker overlay.

The bridge keeps the latest 20 screenshots in memory. It does not write game frames to disk. The tracker currently displays screenshots but does not OCR them yet; use **Manual entry** for level and EXP values.

## Manual mode

Open `index.html` in a modern browser and use **Manual entry** to add cumulative EXP readings. The dashboard stores readings in local browser storage, calculates the rate from samples in the trailing five minutes, charts EXP over time, and estimates time to the next level.

## Files

- `index.html` — dashboard and OBS overlay
- `obs/maple-track-capture.lua` — configurable OBS timer script
- `obs/maple-track-obs-bridge.js` — local OBS WebSocket screenshot bridge

## Next implementation step

Add region selection and local OCR for the level and EXP readouts. Validate the Classic leveling curve with known character readings before relying on level-up predictions.
