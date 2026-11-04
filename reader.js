(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./map-name") : root.MapleMapName,
    typeof module === "object" && module.exports ? require("./drop-feed-probe") : root.MapleDropFeedProbe,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MapleReader = api;
})(typeof window === "undefined" ? globalThis : window, function (MapName, DropFeedProbe) {
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
    mapNameApi = MapName,
    onMesoPreview = () => {},
    onMapPreview = () => {},
  }) {
    let busy = false,
      mesoReading = false,
      customRegionFailureStreak = 0,
      lastCustomRegionFailureAt = null,
      lastAutoRegionRecoveryAt = null,
      lastMesoReadAt = 0,
      lastMapDetectAt = 0,
      lastMapAttemptAt = 0,
      lastMapCropHash = null,
      lastMapFailureHash = null,
      mapProbeBaseline = null,
      mapProbeCandidate = null,
      mapProbeCandidateCount = 0,
      mapProbeTriggered = false,
      dropProbe = DropFeedProbe?.create?.(),
      lastDropTextAt = new Map(),
      dropReadActive = false,
      pendingDropRead = null,
      lastDropReadAt = 0;
    function mapProbeFingerprint(image) {
      const crop = mapNameApi?.cropHeaderText?.(image);
      if (!crop?.data || !crop.width || !crop.height) return null;
      const columns = 64,
        rows = 12,
        fingerprint = new Uint8Array(columns * rows);
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const x0 = Math.floor((column * crop.width) / columns),
            x1 = Math.max(x0 + 1, Math.floor(((column + 1) * crop.width) / columns)),
            y0 = Math.floor((row * crop.height) / rows),
            y1 = Math.max(y0 + 1, Math.floor(((row + 1) * crop.height) / rows));
          let dark = 0,
            total = 0;
          for (let y = y0; y < Math.min(y1, crop.height); y++)
            for (let x = x0; x < Math.min(x1, crop.width); x++) {
              const index = (y * crop.width + x) * 4,
                luminance =
                  0.2126 * crop.data[index] +
                  0.7152 * crop.data[index + 1] +
                  0.0722 * crop.data[index + 2];
              if (luminance < 105) dark++;
              total++;
            }
          fingerprint[row * columns + column] = total
            ? Math.round((dark / total) * 15)
            : 0;
        }
      return fingerprint;
    }
    function mapProbeDistance(left, right) {
      if (!left || !right || left.length !== right.length) return 1;
      let changed = 0;
      for (let i = 0; i < left.length; i++)
        if (Math.abs(left[i] - right[i]) >= 2) changed++;
      return changed / left.length;
    }
    function observeMapProbe(image) {
      if (!localOcr || !mapNameApi || mapProbeTriggered || !image?.data) return false;
      let fingerprint;
      try {
        fingerprint = mapProbeFingerprint(image);
      } catch {
        return false;
      }
      if (!fingerprint) {
        mapProbeCandidate = null;
        mapProbeCandidateCount = 0;
        return false;
      }
      if (!mapProbeBaseline) {
        mapProbeBaseline = fingerprint;
        return false;
      }
      if (mapProbeDistance(fingerprint, mapProbeBaseline) < 0.012) {
        mapProbeCandidate = null;
        mapProbeCandidateCount = 0;
        return false;
      }
      if (
        mapProbeCandidate &&
        mapProbeDistance(fingerprint, mapProbeCandidate) < 0.008
      ) mapProbeCandidateCount++;
      else {
        mapProbeCandidate = fingerprint;
        mapProbeCandidateCount = 1;
      }
      // The first changed probe starts the debounce. A second consecutive
      // changed probe confirms it before requesting the full-resolution OCR.
      if (mapProbeCandidateCount < 2) return false;
      mapProbeTriggered = true;
      return true;
    }
    function resolveMapProbe(accepted) {
      if (accepted && mapProbeCandidate) mapProbeBaseline = mapProbeCandidate;
      mapProbeCandidate = null;
      mapProbeCandidateCount = 0;
      mapProbeTriggered = false;
    }
    function resetMapProbe() {
      mapProbeBaseline = null;
      mapProbeCandidate = null;
      mapProbeCandidateCount = 0;
      mapProbeTriggered = false;
    }
    function resetDropProbe() {
      dropProbe?.reset();
      lastDropTextAt.clear();
      pendingDropRead = null;
      lastDropReadAt = 0;
    }
    function observeDropProbe(image) {
      return Boolean(
        !session.state.paused &&
          session.state.running &&
          dropProbe?.observe(image),
      );
    }
    async function processDropNotice({
      image,
      timestamp,
      generation,
      sessionStartAt,
    }) {
      if (
        session.state.paused ||
        generation !== getCapture().generation ||
        !getCapture().stream ||
        sessionStartAt !== session.state.startAt
      ) return [];
      try {
        const prepared = DropFeedProbe?.prepareOcrImage?.(image) || image,
          result = await localOcr.read({ dropImage: prepared });
        if (
          session.state.paused ||
          generation !== getCapture().generation ||
          !getCapture().stream ||
          sessionStartAt !== session.state.startAt
        ) return [];
        if (!Number.isFinite(result?.dropNotice?.confidence) || result.dropNotice.confidence < 50)
          return [];
        const notices = DropFeedProbe?.parseNotices?.(result?.dropNotice?.text) || [];
        for (const notice of notices) {
          const key = notice.toLocaleLowerCase(),
            previous = lastDropTextAt.get(key);
          if (previous !== undefined && timestamp - previous < 1200) continue;
          lastDropTextAt.set(key, timestamp);
          if (lastDropTextAt.size > 100)
            for (const [text, at] of lastDropTextAt)
              if (timestamp - at > 10000) lastDropTextAt.delete(text);
          session.addDropNotice(
            notice,
            timestamp,
            result?.dropNotice?.confidence,
          );
        }
        return notices;
      } catch {
        return [];
      }
    }
    async function drainDropNotices() {
      if (dropReadActive) return;
      dropReadActive = true;
      try {
        while (pendingDropRead && !session.state.paused) {
          let job = pendingDropRead;
          pendingDropRead = null;
          const wait = Math.max(0, 350 - (job.timestamp - lastDropReadAt));
          if (wait)
            await new Promise((resolve) => setTimeout(resolve, wait));
          if (pendingDropRead) {
            job = pendingDropRead;
            pendingDropRead = null;
          }
          lastDropReadAt = job.timestamp;
          await processDropNotice(job);
        }
      } finally {
        dropReadActive = false;
        if (pendingDropRead && !session.state.paused)
          void drainDropNotices();
      }
    }
    function readDropNotice(image, timestamp) {
      if (!localOcr?.read || !session.addDropNotice || session.state.paused)
        return false;
      // Coalesce during OCR; the newest crop still contains the feed's recent
      // lines, so a burst cannot build an unbounded recognition queue.
      pendingDropRead = {
        image,
        timestamp,
        generation: getCapture().generation,
        sessionStartAt: session.state.startAt,
      };
      void drainDropNotices();
      return true;
    }
    async function recoverAutoRegions(frame, readAt, generation, result) {
      if (session.state.calibration?.auto !== false) {
        customRegionFailureStreak = 0;
        lastCustomRegionFailureAt = readAt;
        return null;
      }
      const reason = result?.rejectionReason || "",
        regionFailure =
          !frame._hudRegions?.exp ||
          frame._reading?.expResult?.uncertain === true ||
          !Number.isFinite(result?.exp) ||
          (result?.pct !== null &&
            result?.pct !== undefined &&
            Number.isFinite(result?.computedPct) &&
            Math.abs(result.computedPct - result.pct) > 0.03) ||
          /EXP characters are unclear|No readable EXP amount or percentage|EXP amount and percentage disagree/.test(
            reason,
          );
      if (!regionFailure) {
        customRegionFailureStreak = 0;
        lastCustomRegionFailureAt = readAt;
        return null;
      }
      if (lastCustomRegionFailureAt !== readAt) {
        lastCustomRegionFailureAt = readAt;
        customRegionFailureStreak++;
      }
      if (customRegionFailureStreak < 3 || lastAutoRegionRecoveryAt === readAt)
        return null;
      lastAutoRegionRecoveryAt = readAt;

      const previousRegions = frame._hudRegions,
        previousReading = frame._reading;
      await recognition.decodeFrame(frame, { forceAuto: true });
      if (
        session.state.paused ||
        generation !== getCapture().generation ||
        !getCapture().stream
      ) {
        frame._hudRegions = previousRegions;
        frame._reading = previousReading;
        return null;
      }
      const detected = frame._reading;
      if (frame._hudRegions?.exp && detected) {
        const { levelResult, expResult } = detected,
          recovered = session.validate(
            levelResult,
            expResult,
            levelResult.expectedDigits,
            readAt,
          );
        if (recovered.valid) {
          session.state.calibration = { level: null, exp: null, auto: true };
          session.save();
          customRegionFailureStreak = 0;
          view.updateRegionStatus?.();
          view.drawRegions?.();
          view.notice?.(
            "Repeated HUD read failures detected. Switched to auto regions; normal OCR checks still apply.",
          );
          return { levelResult, expResult, result: recovered };
        }
      }
      frame._hudRegions = previousRegions;
      frame._reading = previousReading;
      recognition.reset?.();
      session.clearPending();
      customRegionFailureStreak = 0;
      return null;
    }
    function reportMapFailure(frame, readAt, failureHash, reason) {
      if (!debug || !debugTools?.rejectFrame || failureHash === lastMapFailureHash)
        return;
      try {
        void Promise.resolve(debugTools.rejectFrame(frame, readAt, reason))
          .then((saved) => {
            // Remember only a submitted download. If downloads are disabled or
            // the frame cannot be encoded, try again on the next capture.
            if (saved) lastMapFailureHash = failureHash;
          })
          .catch(() => {});
      } catch {}
    }
    function readMapName(frame, readAt, generation, force = false) {
      if (!localOcr || !mapNameApi || !frame?._pixels || (!force && readAt - lastMapDetectAt < 9000))
        return;
      lastMapDetectAt = readAt;
      let mapImage;
      try {
        mapImage = mapNameApi.cropHeaderText(frame._pixels);
      } catch {
        return;
      }
      if (!mapImage) {
        reportMapFailure(frame, readAt, "no-map-header", "map-header-not-found");
        if (debug)
          try { onMapPreview(null); view.showMapStatus?.("No map header found"); } catch {}
        return;
      }
      if (debug)
        try { onMapPreview(mapNameApi.prepare(mapImage)); } catch {}
      const hash = mapNameApi.hash(mapImage);
      // Keep retrying an unrecognized header at the normal capture cadence.
      // A one-minute same-crop throttle can leave the stream card blank after
      // a single transient OCR miss. Once a name is known, recheck unchanged
      // headers only once per minute while still detecting map changes fast.
      if (
        !force &&
        hash === lastMapCropHash &&
        session.state.mapName &&
        readAt - lastMapAttemptAt < 60000
      ) return;
      lastMapCropHash = hash;
      lastMapAttemptAt = readAt;
      const sessionStartAt = session.state.startAt;
      void localOcr
        .read({ mapImage, includeMapDebug: debug })
        .then((result) => {
          if (
            session.state.paused ||
            generation !== getCapture().generation ||
            !getCapture().stream ||
            sessionStartAt !== session.state.startAt
          ) return;
          if (debug) {
            const raw = (result?.mapDebug || []).map((entry) => {
              const text = String(entry.text || "[empty]").replace(/\s+/g, " ").slice(0, 70);
              return `${entry.kind}: ${text} (${entry.confidence ?? "no confidence"}%)`;
            });
            view.showMapStatus?.(
              result?.map?.text
                ? `Matched ${result.map.text} · ${raw.join(" → ")}`
                : `No match · ${result?.mapDebugError || raw.join(" → ") || "No OCR output"}`,
            );
          }
          if (result?.map?.canonicalized && result.map.text) {
            lastMapFailureHash = null;
            if (force) resolveMapProbe(true);
            session.setMapName?.(result.map.text, readAt);
          } else {
            if (force) resolveMapProbe(false);
            reportMapFailure(frame, readAt, hash, "map-name-not-found");
          }
        })
        .catch((error) => {
          if (force) resolveMapProbe(false);
          if (debug) view.showMapStatus?.(`OCR error: ${String(error?.message || error).slice(0, 100)}`);
          reportMapFailure(frame, readAt, hash, "map-name-ocr-error");
        });
    }
    async function read(frame, timestamp, { report = true, forceMap = false } = {}) {
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
        readMapName(frame, readAt, generation, forceMap);
        if (!frame._hudRegions?.exp) {
          const recovered = await recoverAutoRegions(frame, readAt, generation, null);
          if (recovered) {
            view.renderReading(
              recovered.result,
              recovered.levelResult,
              recovered.expResult,
              readAt,
            );
            session.addSample(
              recovered.result.level,
              recovered.result.exp,
              readAt,
              recovered.expResult.percentageOnly || {},
            );
            view.saved(readAt);
            return { accepted: true, retry: false };
          }
          session.clearPending();
          view.status("waiting", "Looking for the EXP readout");
          view.output(
            "Looking for the EXP readout. Keep the bottom HUD visible and unobstructed, or select a custom region in debug mode.",
          );
          if (debug && report)
            await debugTools.rejectFrame(frame, readAt, "exp-readout-not-found");
          return { accepted: false, retry: true };
        }
        let { levelResult, expResult } = frame._reading,
          result = session.validate(
            levelResult,
            expResult,
            levelResult.expectedDigits,
            readAt,
          );
        if (!result.valid) {
          const recovered = await recoverAutoRegions(frame, readAt, generation, result);
          if (recovered) {
            ({ levelResult, expResult, result } = recovered);
          }
        } else {
          customRegionFailureStreak = 0;
          lastCustomRegionFailureAt = readAt;
        }
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
      observeMapProbe,
      resetMapProbe,
      resolveMapProbe,
      observeDropProbe,
      readDropNotice,
      resetDropProbe,
      get busy() {
        return busy;
      },
    };
  }
  return { cropNormalized, create };
});
