# Maple Track

A browser tracker for MapleStory Classic EXP. Share the game window and read EXP locally every 10 seconds. Each automatic reading uses a short burst of three frames, spaced 250 ms apart, and needs two matching clear level/EXP readings. Repeated video frames do not count as additional votes. Uncertain bursts keep the last accepted value.

**Open the tracker:** https://dwlim.github.io/maple-exp-tracker/

Pushes to `main` run the capture and OCR checks, then publish only the standalone dashboard through GitHub Pages. Test crops and developer scripts are not part of the deployed site.

## Browser capture (default)

Automatic regions search the bottom 35% of the shared surface for orange tiles beside the white LV label and for the green EXP brackets. The detector follows validated regions and searches again when the text stops matching, the window moves, or its dimensions change. No fixed screen-percentage boxes are used for recognition. A covered or unreadable EXP readout waits for a clearer capture; debug mode still supports custom regions. Tests composite only real HUD crops at multiple sizes and positions; they do not guarantee recognition when scaling removes text detail. `node tools/test-hud-regions.cjs` checks detection and reacquisition.

Level recognition detects the orange tiles and uses the blue/red color ratio to separate white strokes from orange without a hard brightness threshold. Soft anti-aliased masks are compared with templates for all ten digits, allowing small translations and scale changes. Both fit error and the lead over the next digit must pass. An uncertain digit remains `?`; a previous level is never substituted.

When the orange digits are unclear, the tracker can independently identify a level from the EXP amount and percentage. It requires exactly one matching EXP requirement and two consecutive distinct frames within 25 seconds, with at least 0.5% displayed. Clear level digits that conflict with a unique EXP-derived level are rejected. EXP glyphs repaired using a presumed level never count as independent evidence. Debug output marks a confirmed fallback as "level from EXP". `node tools/test-level-inference.cjs` checks this path and its safeguards.

The level normally stays unchanged. A one-level increase needs confirmation on a second distinct frame; unexpected jumps are rejected. Use **New session** when switching characters or starting over. Both level and EXP use bundled local glyph matchers; no OCR model is downloaded. `node tools/test-level-ocr.cjs` covers actual saved crops, the optional local browser crop, padding, ambiguity and level continuity. The local expanded set reads 212/240 brightness/scaling cases exactly and rejects 28, with no wrong complete levels accepted in that set. These calibration/regression images do not establish accuracy on every user's display.

`tools/build-level-font.py` extracts manually transcribed local crops, and `node tools/build-level-font.cjs` rebuilds the standalone level matcher and its embedded copy in `index.html`. `tools/build-level-stress.py` produces optional local scaling fixtures. Local diagnostic screenshots and test captures remain excluded from version control.

1. Open the dashboard in desktop Chrome or Edge on HTTPS or localhost. The local development address is `http://127.0.0.1:8000/` when a static server is running.
2. Click **Share game window** and choose the MapleStory window in the browser picker. The picker must be completed each session.
3. Keep the dashboard open while playing. The preview confirms the chosen window; screenshots and recognition stay in the browser, and audio capture is disabled. Recognition code and templates are bundled with the page.
4. Click **Stop sharing**, or stop from the browser’s sharing control. Previously accepted session readings remain saved. A refresh stops capture; click Share again to reconnect.

For calibration and raw diagnostics, use `?debug=1`. Window borders, a different game resolution or HUD layout may require adjusting the regions in debug mode. The in-app preview may not expose screen sharing; use desktop Chrome or Edge if the app reports it unavailable. Manual entry remains available.

The app is published on GitHub Pages. Any ordinary HTTPS static host can serve `index.html`; no application backend or local bridge is required. For local development, run `python -m http.server 8000 --bind 127.0.0.1` and open `http://127.0.0.1:8000/`.

Run `node tools/test-browser-capture.cjs` for capture lifecycle checks. Live game-window sharing requires a manual browser picker test.

Level and EXP both use dedicated glyph matchers built from this Classic client's actual HUD digits, rather than a substitute system font. It separates the green brackets from the white digits, normalizes glyphs into fixed comparison grids, and rejects ambiguous glyphs. Oversized level glyphs also support area sampling. Unclear EXP crops are retried at two canonical glyph heights (18 and 24 pixels), and both must agree before recovering a reading. Joined EXP digits use several plausible low-ink boundaries, scored by the complete digit sequence; close competing sequences remain rejected. Commas read as periods are normalized only in the integer EXP amount. The displayed percentage must agree with the EXP table within 0.03 percentage points before saving. The enlarged crop below the OCR result shows exactly what the matcher sees.

Use **Reset auto regions** to return from custom selections to automatic HUD detection. For custom selections, exclude the bold `EXP.` label and include all the digits, brackets and `%`, with a small margin. Different HUD layouts, scaling, or very long numbers may need a custom selection. Keep the dashboard tab open during the session. **Manual entry** remains available if a reading needs correction. All recognition runs locally with bundled templates.

Run `node tools/test-hud-font.cjs` to check the extracted HUD crops, including withheld screenshots and additional capture crops. The current set produces 30 exact readings across 30 saved screenshots (including five held out from template extraction), plus two additional exact capture readings; this is a local regression set, not an accuracy guarantee for all layouts. `hud-ocr.js` is embedded in `index.html` so the standalone page still works. Rebuild the embedded matcher with `node tools/hud-matcher.cjs` after changing the matching logic or templates. The font templates and fixtures contain only the cropped HUD text, not full game screenshots.

## Dashboard and debug mode

In browser capture debug mode (`?debug=1`), only frames rejected by OCR request a timestamped PNG download; accepted readings never create screenshot files. These are full screenshots of the shared surface saved to the browser's download location; they are not uploaded. The browser may require allowing multiple automatic downloads, and save-location prompts depend on browser settings. Uncheck **Download screenshots with rejected readings** to stop downloads, or remove the debug flag. Normal mode never downloads screenshots automatically.

The normal dashboard shows session metrics, character progress, connection status and recent readings. The rate-card hint shows why a capture was rejected instead of leaving it at "waiting for more samples". A detected level that conflicts with the saved session shows both levels and asks you to start a new session when switching characters. Automatic OCR continues in the background. Manual entry remains available.

Open `http://127.0.0.1:8000/?debug=1` for the captured game frame, highlighted regions, calibration buttons, raw OCR text, confidence and enlarged EXP crop. Remove `debug=1` to return to the normal dashboard.

## Recognition validation

The glyph matcher normalizes usable frame brightness and compares both pixel coverage and sharp edges, with additional weight on the strokes distinguishing 3/8/9. It compares punctuation size to the digit row rather than the crop height, so extra vertical padding does not turn digits into decimal points. Both green brackets must be visible; missing brackets are not synthesized. Very dark/faded frames and ambiguous matches are skipped.

`node tools/stress-hud-font.cjs --strict` runs 238 original, brightness-adjusted and gamma-adjusted cases. The reviewed matcher reads 189 exactly and rejects 49, with no incorrect complete readings in this set (previous matcher: 146 exact, 92 rejected). These transformed crops measure regression robustness, not independent real-world accuracy. Several saved regression crops were also used to calibrate templates. Run `node tools/test-hud-font.cjs` for real crop regressions, 3/8/9 confusions, extra-padding and missing-bracket checks.

## Percentage-only EXP readouts

When the HUD hides the amount and shows only a percentage, the tracker estimates current EXP from the displayed percentage and the EXP requirement for a clearly recognized level. Both bracketed (`[78.82%]`) and bare (`78.82%`) readouts are supported. Automatic detection also requires the EXP label; a clipped full reading is not treated as percentage-only. The displayed format selects this mode; readings remain supported below one million, including after a level-up. Uncertain percentage digits or an unreadable level are skipped.

These amounts are approximate because the HUD rounds its percentage to two decimals. Estimated samples are marked in the capture log; affected totals/rates use `~` and the dashboard explains the estimate. A previous EXP value inside the displayed percentage's rounding interval is retained to avoid artificial gains/losses when switching formats. After leveling up, normal full-amount readings resume. `node tools/test-percentage-only.cjs` covers validation, detection with layouts composited from real glyph pixels, and switching back to exact readings; the supplied native HUD screenshot at level 60 with 92.09% is included as a regression case. Other display-specific variations may still require calibration.

## Stream card

Click **Open stream card** for a compact live view of level, EXP/hour, progress and time to level. In your streaming software, add **Window Capture**, select the Maple Track stream card browser window, and crop out the browser chrome. Keep the main tracker and card open in the same browser profile. The card syncs locally through browser storage; no backend or bridge is used. It shows paused/offline status when tracking stops or the main tracker closes.

This window is intended for Window Capture. A separate Browser Source in streaming software has isolated storage and will not receive readings from your browser. Start sharing from the main tracker; the card itself does not request screen access.

## Manual mode

Open `index.html` in a modern browser and use **Manual entry** to add your level and the EXP number shown for that level. The dashboard stores readings in local browser storage, calculates the rate from samples in the trailing five minutes, charts total progress over time, and estimates time to the next level.

## Files

- `index.html` — standalone browser dashboard
- `level-ocr.js`, `hud-ocr.js` — local level and EXP recognition
- `hud-regions.js` — automatic HUD detection
- `stream-card.js` — live stream card and local session sync
- `tools/` — build scripts and regression checks

## Leveling data and calibration

The sample shows Level 52 and `542,829 (68.74%)`; this matches the level 52 requirement of 789,631 EXP. The dashboard uses that HUD layout to set initial OCR regions automatically. It interprets the number as EXP within the current level, converts samples to total EXP for rates across level-ups, and computes the next-level remainder from the curve.

The curve formulas follow the [MeowDB MapleStory Classic EXP table](https://meowdb.com/msclassic/guides/exp-table-level-1-to-100): levels 1–5 and 6–50 use separate formulas, levels 51–89 increase by 1.0548 per level, and levels 90–99 by 2.1. Level 100 is treated as the cap.

### Independent live-stream validation

`tools/stream-holdout-fixtures.json` contains visually labelled native HUD crops from Shiphtur's public Twitch stream, separate from all font training inputs. Two fullscreen captures include 63 / 94.65% and 63 / 95.09%; a third capture includes 63 / 95.35% after an ad resized the game view. Only level and EXP patches are stored in the repository.

Run `node tools/validate-stream-hud.cjs` to print accepted, rejected and wrong counts. Add `--strict` to fail unless every case passes. The initial baseline in `tools/stream-holdout-baseline.json` is **0 passed, 3 rejected, 0 wrong**; these are known recognition/detection failures, not successful validation. Font generators never read this file. `--write-report` explicitly replaces the baseline report.
