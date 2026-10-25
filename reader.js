(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleReader = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  function create({
    session,
    recognition,
    view,
    debugTools,
    getCapture,
    debug = false,
  }) {
    let busy = false;
    async function read(frame, timestamp, { report = true } = {}) {
      if (session.state.paused || busy) return;
      const generation = getCapture().generation;
      busy = true;
      view.reading(true);
      try {
        if (!frame._hudRegions || (frame._hudRegions.exp && !frame._reading))
          await recognition.decodeFrame(frame);
        if (
          session.state.paused ||
          generation !== getCapture().generation ||
          !getCapture().stream
        )
          return;
        const rawTime = Number(timestamp) || Date.now(),
          readAt = rawTime < 1e12 ? rawTime * 1000 : rawTime;
        if (!frame._hudRegions?.exp) {
          session.clearPending();
          view.status("waiting", "Looking for the EXP readout");
          view.output(
            "Looking for the EXP readout. Keep the bottom HUD visible and unobstructed, or select a custom region in debug mode.",
          );
          if (debug && report) await debugTools.rejectFrame(frame, readAt);
          return { accepted: false, retry: true };
        }
        const { levelResult, expResult } = frame._reading,
          result = session.validate(
            levelResult,
            expResult,
            levelResult.expectedDigits,
            readAt,
          );
        view.renderReading(result, levelResult, expResult, readAt);
        const confirmation =
          result.continuity.reason ===
            "Confirming level up on the next frame" ||
          result.levelResolution.reason ===
            "Confirming level from EXP on the next frame";
        if (debug && report && !result.valid && !confirmation)
          await debugTools.rejectFrame(frame, readAt);
        if (result.valid) {
          const prior = session.state.samples.at(-1);
          if (!prior || prior.t !== readAt)
            session.addSample(
              result.level,
              result.exp,
              readAt,
              expResult.percentageOnly || {},
            );
          view.saved(readAt);
        }
        return { accepted: result.valid, retry: result.retry };
      } catch (error) {
        view.status("error", "Recognition unavailable · " + error.message);
        view.output("OCR failed: " + error.message);
        return { accepted: false, retry: false };
      } finally {
        busy = false;
        view.reading(false);
      }
    }
    return {
      read,
      get busy() {
        return busy;
      },
    };
  }
  return { create };
});
