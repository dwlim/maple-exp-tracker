(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleReader = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  function cropNormalized(image, region) {
    if (!image?.data || !region) return null;
    const x0 = Math.max(0, Math.floor(region.x * image.width)),
      y0 = Math.max(0, Math.floor(region.y * image.height)),
      x1 = Math.min(image.width, Math.ceil((region.x + region.w) * image.width)),
      y1 = Math.min(image.height, Math.ceil((region.y + region.h) * image.height)),
      width = x1 - x0,
      height = y1 - y0;
    if (width < 2 || height < 2) return null;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      data.set(
        image.data.subarray(((y + y0) * image.width + x0) * 4, ((y + y0) * image.width + x1) * 4),
        y * width * 4,
      );
    return { width, height, data };
  }
  function create({
    session,
    recognition,
    view,
    debugTools,
    getCapture,
    localOcr,
    debug = false,
  }) {
    let busy = false,
      mesoReading = false,
      lastMesoReadAt = 0;
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
        if (
          localOcr && frame._pixels && (session.state.mesoAnchor || session.state.mesoRegion) && !mesoReading &&
          (!lastMesoReadAt || readAt - lastMesoReadAt >= 60000)
        ) {
          lastMesoReadAt = readAt;
          mesoReading = true;
          const sessionStartAt = session.state.startAt;
          let mesoRegion = session.state.mesoRegion;
          if (session.state.mesoAnchor) {
            const match = localOcr.locateMesoAnchor(
              frame._pixels,
              session.state.mesoAnchor,
              session.state.mesoRegion,
            );
            mesoRegion = match?.region || null;
            if (mesoRegion) session.state.mesoRegion = mesoRegion;
            if (!mesoRegion)
              session.setMesoStatus("Inventory anchor not found · keep the item window visible");
          }
          if (!mesoRegion) {
            mesoReading = false;
          } else {
            void localOcr
            .read({ mesoImage: cropNormalized(frame._pixels, mesoRegion) })
            .then((mesoResult) => {
              if (
                session.state.paused ||
                generation !== getCapture().generation ||
                sessionStartAt !== session.state.startAt
              ) return;
              if (mesoResult?.meso)
                session.addMesoSample(mesoResult.meso.amount, readAt);
              else
                session.setMesoStatus(
                  "Meso total unreadable · keep the inventory open and amount unobstructed",
                );
            })
            .catch(() => {
              if (
                !session.state.paused &&
                generation === getCapture().generation &&
                sessionStartAt === session.state.startAt
              )
                session.setMesoStatus("Meso read unavailable · EXP tracking continues");
            })
            .finally(() => {
              mesoReading = false;
            });
          }
        }
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
  return { cropNormalized, create };
});
