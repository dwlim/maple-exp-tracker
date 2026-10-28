(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./map-name") : root.MapleMapName,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MapleReader = api;
})(typeof window === "undefined" ? globalThis : window, function (MapName) {
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
    getMesoReference,
    debug = false,
    onMesoPreview = () => {},
    onMapPreview = () => {},
  }) {
    let busy = false,
      mesoReading = false,
      lastMesoReadAt = 0,
      lastMapDetectAt = 0,
      lastMapAttemptAt = 0,
      lastMapCropHash = null;
    function readMapName(frame, readAt, generation) {
      if (!localOcr || !MapName || !frame?._pixels || readAt - lastMapDetectAt < 9000)
        return;
      lastMapDetectAt = readAt;
      let mapImage;
      try {
        mapImage = MapName.cropHeaderText(frame._pixels);
      } catch {
        return;
      }
      if (!mapImage) {
        if (debug)
          try { onMapPreview(null); } catch {}
        return;
      }
      if (debug)
        try { onMapPreview(MapName.prepare(mapImage)); } catch {}
      const hash = MapName.hash(mapImage);
      // Keep retrying an unrecognized header at the normal capture cadence.
      // A one-minute same-crop throttle can leave the stream card blank after
      // a single transient OCR miss. Once a name is known, recheck unchanged
      // headers only once per minute while still detecting map changes fast.
      if (
        hash === lastMapCropHash &&
        session.state.mapName &&
        readAt - lastMapAttemptAt < 60000
      ) return;
      lastMapCropHash = hash;
      lastMapAttemptAt = readAt;
      const sessionStartAt = session.state.startAt;
      void localOcr
        .read({ mapImage })
        .then((result) => {
          if (
            session.state.paused ||
            generation !== getCapture().generation ||
            !getCapture().stream ||
            sessionStartAt !== session.state.startAt
          ) return;
          if (result?.map?.text) session.setMapName?.(result.map.text, readAt);
        })
        .catch(() => {});
    }
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
          localOcr && frame._pixels && !mesoReading &&
          (!lastMesoReadAt || readAt - lastMesoReadAt >= 10000)
        ) {
          lastMesoReadAt = readAt;
          mesoReading = true;
          const sessionStartAt = session.state.startAt;
          // Migrate old saved anchors: the amount crop now includes the full
          // white balance box, so its previous coordinates must be rediscovered.
          if (session.state.mesoAnchor && session.state.mesoAnchor.version !== 3) {
            session.state.mesoAnchor = null;
            session.state.mesoRegion = null;
            session.save();
          }
          let mesoRegion = session.state.mesoRegion;
          if (session.state.mesoAnchor && mesoRegion) {
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
          {
            const input = mesoRegion
              ? { mesoImage: cropNormalized(frame._pixels, mesoRegion) }
              : { mesoScanImage: frame._pixels };
            if (debug && input.mesoScanImage)
              input.onMesoPreview = onMesoPreview;
            const mesoRead = input.mesoScanImage && getMesoReference
              ? getMesoReference().then((mesoReference) => localOcr.read({ ...input, mesoReference }))
              : localOcr.read(input);
            void mesoRead
            .then((mesoResult) => {
              if (
                session.state.paused ||
                generation !== getCapture().generation ||
                sessionStartAt !== session.state.startAt
              ) return;
              if (debug) onMesoPreview(mesoResult?.mesoPreview || null);
              const mesoCandidate = mesoResult?.meso?.region
                ? mesoResult.meso
                : mesoResult?.mesoCandidate;
              if (mesoCandidate?.region && !session.state.mesoAnchor) {
                const anchor = localOcr.createMesoAnchor?.(
                  frame._pixels,
                  mesoCandidate.region,
                  mesoCandidate.border,
                ) || null;
                if (anchor)
                  session.setMesoAnchor?.(mesoCandidate.region, anchor);
                else
                  session.setMesoRegion?.(mesoCandidate.region);
                view.drawRegions?.();
                view.updateRegionStatus?.();
              }
              if (mesoResult?.meso)
                session.addMesoSample(mesoResult.meso.amount, readAt);
              else
                session.setMesoStatus(
                  session.state.mesoAnchor
                    ? "Meso total unreadable · keep the inventory open and amount unobstructed"
                    : "Searching for the inventory balance · keep the inventory visible",
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
        // Map recognition is optional and runs asynchronously after scheduling
        // the independent meso read; it never changes EXP acceptance.
        readMapName(frame, readAt, generation);
        if (!frame._hudRegions?.exp) {
          session.clearPending();
          view.status("waiting", "Looking for the EXP readout");
          view.output(
            "Looking for the EXP readout. Keep the bottom HUD visible and unobstructed, or select a custom region in debug mode.",
          );
          if (debug && report)
            await debugTools.rejectFrame(frame, readAt, "exp-readout-not-found");
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
          await debugTools.rejectFrame(frame, readAt, result.rejectionReason);
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
        if (debug && report)
          try {
            await debugTools.rejectFrame(frame, timestamp, "ocr-processing-error");
          } catch {
            /* A diagnostic download must not replace the original OCR error. */
          }
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
