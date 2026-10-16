# Maple Track

A browser tracker for MapleStory Classic EXP. Share the game window and read EXP locally every 10 seconds.

**Open the tracker:** https://dwlim.github.io/maple-exp-tracker/

Pushes to `main` run the capture and OCR checks, then publish only the standalone dashboard through GitHub Pages. Test crops, scripts and local bridge files are not part of the deployed site.

## Browser capture (default)

Level recognition detects the orange tiles, reads each digit separately at three contrast thresholds, and requires two agreeing results per tile. An uncertain leading digit produces a rejected level, not a shorter level number. Run `node tools/test-level-ocr.cjs` for tile and consensus regressions.

1. Open the dashboard in desktop Chrome or Edge on HTTPS or localhost. The local development address is `http://127.0.0.1:8000/` when a static server is running.
2. Click **Share game window** and choose the MapleStory window in the browser picker. No OBS, Lua script, bridge, or OBS password is needed for this capture mode. The picker must be completed each session.
3. Keep the dashboard open while playing. The preview confirms the chosen window; screenshots and OCR stay in the browser, and audio capture is disabled. Internet access is still needed on first use for Tesseract and its level model.
4. Click **Stop sharing**, or stop from the browser’s sharing control. Previously accepted session readings remain saved. A refresh stops capture; click Share again to reconnect.

For calibration and raw diagnostics, use `?debug=1`. Window borders, a different game resolution or HUD layout may require adjusting the regions in debug mode. The in-app preview may not expose screen sharing; use desktop Chrome or Edge if the app reports it unavailable. Manual entry remains available.

The app is still served locally for development; this change does not publish a hosted website. Any ordinary HTTPS static host can serve `index.html` for the browser capture mode. No runtime server-side screenshot processing is required.

Run `node tools/test-browser-capture.cjs` for capture lifecycle checks. Live game-window sharing requires a manual browser picker test.

## Capture through OBS

This is an optional legacy mode. Open `http://127.0.0.1:8000/?capture=obs` to enable the bridge connection; add `&debug=1` for calibration. The bridge-backed OBS overlay uses `?overlay=1&capture=obs`. Browser sharing does not sync to an OBS Browser Source, so the overlay link is hidden in the default browser mode.

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

4. In OBS, open **Tools → Scripts**, add `obs/maple-track-capture.lua`, select the game capture source, and click **Start capture timer**. The interval defaults to 10 seconds.
5. Open `http://127.0.0.1:8000` in a browser to see the dashboard. Add `http://127.0.0.1:8000/index.html?overlay=1` to OBS as a Browser Source for the tracker overlay.

The bridge keeps the latest 20 screenshots and current tracker readings in memory. It does not write game frames to disk. The dashboard starts with automatic Level and EXP regions based on the supplied screenshot, with separate defaults for a full 16:9 game source and the screenshot's wider stream layout. The first capture is read automatically, and subsequent captures are read every 10 seconds. If the OBS source has a different layout, drag over the Level and EXP readouts once; those custom regions are saved in the browser. **Reset auto regions** restores the defaults. The tracker accepts a reading only when the values are in range, OCR confidence is sufficient, and the displayed percentage agrees with the EXP table when it was recognized. Uncertain readings are not added to the session. The OBS Browser Source overlay polls the bridge for accepted readings, so it stays in sync with the dashboard even though it has separate browser storage.

Level OCR uses Tesseract.js in the browser. EXP uses a dedicated glyph matcher built from this Classic client's actual HUD digits, rather than a substitute system font. It separates the green brackets from the white digits, compares digit shapes at native capture resolution, and rejects ambiguous glyphs. Commas read as periods are normalized only in the integer EXP amount. The displayed percentage must agree with the EXP table within 0.03 percentage points before saving. The enlarged crop below the OCR result shows exactly what the matcher sees.

After updating, click **Reset auto regions**. The 16:9 defaults target the numeric EXP amount and its bracketed percentage at 1366×768 and 1920×1080. For custom selections, exclude the bold `EXP.` label and include all the digits, brackets and `%`, with a small margin. Different HUD layouts, scaling, or very long numbers may need a custom selection. Keep the dashboard tab open during the session. **Manual entry** remains available if a reading needs correction. Tesseract's level recognition still downloads its runtime and language data on first use.

Run `node tools/test-hud-font.cjs` to check the extracted HUD crops, including withheld screenshots and the OBS frame. The current set produces 30 exact readings across 30 saved screenshots (including five held out from template extraction), plus two exact OBS readings; this is a local regression set, not an accuracy guarantee for all layouts. `hud-ocr.js` is embedded in `index.html` so the standalone page still works. Rebuild the embedded matcher with `node tools/hud-matcher.cjs` after changing the matching logic or templates. The font templates and fixtures contain only the cropped HUD text, not full game screenshots.

## Manual mode

## Dashboard and debug mode

In browser capture debug mode (`?debug=1`), only frames rejected by OCR request a timestamped PNG download; accepted readings never create screenshot files. These are full screenshots of the shared surface saved to the browser's download location; they are not uploaded. The browser may require allowing multiple automatic downloads, and save-location prompts depend on browser settings. Uncheck **Download screenshots with rejected readings** to stop downloads, or remove the debug flag. Normal mode and overlay mode never download screenshots automatically.

The normal dashboard shows session metrics, character progress, connection status and recent readings. Automatic OCR and reporting continue in the background. Manual entry remains available.

Open `http://127.0.0.1:8000/?debug=1` for the captured game frame, highlighted regions, calibration buttons, raw OCR text, confidence and enlarged EXP crop. Remove `debug=1` to return to the normal dashboard. The OBS overlay stays minimal even if the debug parameter is present.

## Recognition validation

The glyph matcher normalizes usable frame brightness and compares both pixel coverage and sharp edges, with additional weight on the strokes distinguishing 3/8/9. It compares punctuation size to the digit row rather than the crop height, so extra vertical padding does not turn digits into decimal points. Both green brackets must be visible; missing brackets are not synthesized. Very dark/faded frames and ambiguous matches are skipped.

`node tools/stress-hud-font.cjs --strict` runs 238 original, brightness-adjusted and gamma-adjusted cases. The reviewed matcher reads 189 exactly and rejects 49, with no incorrect complete readings in this set (previous matcher: 146 exact, 92 rejected). These transformed crops measure regression robustness, not independent real-world accuracy. Several OBS regression crops were also used to calibrate templates. Run `node tools/test-hud-font.cjs` for real crop regressions, 3/8/9 confusions, extra-padding and missing-bracket checks.

## Manual mode

Open `index.html` in a modern browser and use **Manual entry** to add your level and the EXP number shown for that level. The dashboard stores readings in local browser storage, calculates the rate from samples in the trailing five minutes, charts total progress over time, and estimates time to the next level.

## Files

- `index.html` — dashboard and OBS overlay
- `obs/maple-track-capture.lua` — configurable OBS timer script
- `obs/maple-track-obs-bridge.js` — local OBS WebSocket screenshot bridge

## Leveling data and calibration

The sample shows Level 52 and `542,829 (68.74%)`; this matches the level 52 requirement of 789,631 EXP. The dashboard uses that HUD layout to set initial OCR regions automatically. It interprets the number as EXP within the current level, converts samples to total EXP for rates across level-ups, and computes the next-level remainder from the curve.

The curve formulas follow the [MeowDB MapleStory Classic EXP table](https://meowdb.com/msclassic/guides/exp-table-level-1-to-100): levels 1–5 and 6–50 use separate formulas, levels 51–89 increase by 1.0548 per level, and levels 90–99 by 2.1. Level 100 is treated as the cap.
