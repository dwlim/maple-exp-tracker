# Maple Track

A local browser tracker for MapleStory Classic EXP with an OBS Browser Source overlay.

## Capture through OBS

This prototype uses OBS's built-in obs-websocket screenshot request. The Lua script schedules a local request; the Node bridge asks OBS for a screenshot of the selected source and makes the latest image available to the dashboard. The bridge binds only to `127.0.0.1` and does not contact Twitch.

Requirements: OBS Studio 28 or newer, its built-in WebSocket server enabled, and Node.js 22 or newer.

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

The bridge keeps the latest 20 screenshots and current tracker readings in memory. It does not write game frames to disk. The dashboard starts with automatic Level and EXP regions based on the supplied screenshot, with separate defaults for a full 16:9 game source and the screenshot's wider stream layout. The first capture is read automatically, and subsequent captures are read every 30 seconds. If the OBS source has a different layout, drag over the Level and EXP readouts once; those custom regions are saved in the browser. **Reset auto regions** restores the defaults. The tracker accepts a reading only when the values are in range, OCR confidence is sufficient, and the displayed percentage agrees with the EXP table when it was recognized. Uncertain readings are not added to the session. The OBS Browser Source overlay polls the bridge for accepted readings, so it stays in sync with the dashboard even though it has separate browser storage.

OCR uses Tesseract.js in the browser. Its script, WebAssembly core, and English language data are downloaded from their configured CDNs on first use and cached by the browser; image recognition runs locally. Keep the dashboard tab open during the session. **Manual entry** remains available if a reading needs correction.

## Manual mode

Open `index.html` in a modern browser and use **Manual entry** to add your level and the EXP number shown for that level. The dashboard stores readings in local browser storage, calculates the rate from samples in the trailing five minutes, charts total progress over time, and estimates time to the next level.

## Files

- `index.html` — dashboard and OBS overlay
- `obs/maple-track-capture.lua` — configurable OBS timer script
- `obs/maple-track-obs-bridge.js` — local OBS WebSocket screenshot bridge

## Leveling data and calibration

The sample shows Level 52 and `542,829 (68.74%)`; this matches the level 52 requirement of 789,631 EXP. The dashboard uses that HUD layout to set initial OCR regions automatically. It interprets the number as EXP within the current level, converts samples to total EXP for rates across level-ups, and computes the next-level remainder from the curve.

The curve formulas follow the [MeowDB MapleStory Classic EXP table](https://meowdb.com/msclassic/guides/exp-table-level-1-to-100): levels 1–5 and 6–50 use separate formulas, levels 51–89 increase by 1.0548 per level, and levels 90–99 by 2.1. Level 100 is treated as the cap.
