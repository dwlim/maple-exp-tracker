(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleCapture = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  function create({
    navigator,
    video,
    document,
    session,
    recognition,
    reader,
    view,
    debugTools,
    debug = false,
    onFrame = null,
    onInvalidate = () => {},
    now = Date.now,
    timers = { setTimeout, setInterval, clearInterval },
  }) {
    const FULL_SCAN_INTERVAL_MS = 10000,
      MAP_HEADER_POLL_INTERVAL_MS = 2000,
      DROP_FEED_POLL_INTERVAL_MS = 100,
      DROP_FEED_SCALE = 0.5,
      DROP_FEED_REGION = { x: 0.87, y: 0.82, w: 0.13, h: 0.08 },
      MAP_PROBE_SCALE = 0.5;
    let stream = null,
      timer = null,
      mapTimer = null,
      dropFeedTimer = null,
      mapProbeCanvas = null,
      mapProbeWidth = 0,
      mapProbeHeight = 0,
      dropProbeCanvas = null,
      dropProbeWidth = 0,
      dropProbeHeight = 0,
      dropImageCanvas = null,
      lastDropVideoTime = null,
      generation = 0,
      busy = false,
      connecting = false,
      itemTask = null;
    const delay = (ms) =>
      new Promise((resolve) => timers.setTimeout(resolve, ms));
    function invalidate() {
      generation++;
      session.clearPending();
      reader.resetMapProbe?.();
      reader.resetDropProbe?.();
      onInvalidate();
    }
    function stop() {
      invalidate();
      timers.clearInterval(timer);
      timers.clearInterval(mapTimer);
      timers.clearInterval(dropFeedTimer);
      timer = mapTimer = dropFeedTimer = null;
      if (mapProbeCanvas) {
        mapProbeCanvas.width = 0;
        mapProbeCanvas.height = 0;
      }
      mapProbeCanvas = null;
      mapProbeWidth = mapProbeHeight = 0;
      if (dropProbeCanvas) {
        dropProbeCanvas.width = 0;
        dropProbeCanvas.height = 0;
      }
      if (dropImageCanvas) {
        dropImageCanvas.width = 0;
        dropImageCanvas.height = 0;
      }
      dropProbeCanvas = dropImageCanvas = null;
      dropProbeWidth = dropProbeHeight = 0;
      lastDropVideoTime = null;
      const prior = stream;
      stream = null;
      if (prior) prior.getTracks().forEach((track) => track.stop());
      video.pause();
      video.srcObject = null;
      recognition.reset();
      session.state.running = false;
      session.state.paused = false;
      session.state.source = null;
      view.status(
        "waiting",
        "Sharing stopped. Your session readings are saved.",
      );
      view.update();
    }
    async function captureFrame(force = false, forceMap = false, skipItems = false) {
      if (
        session.state.paused ||
        busy ||
        reader.busy ||
        !stream ||
        video.readyState < 2 ||
        !video.videoWidth
      )
        return;
      const run = generation,
        canvases = [],
        started = now();
      let stage = "capture",
        capturedCount = 0;
      busy = true;
      const cancelled = () =>
        run !== generation || session.state.paused || !stream;
      const capture = () => {
        const frame = document.createElement("canvas");
        canvases.push(frame);
        capturedCount++;
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        frame.getContext("2d").drawImage(video, 0, 0);
        frame._capturedAt = now();
        return frame;
      };
      try {
        const automatic = force || view.isAutomatic(),
          firstTime = video.currentTime,
          firstFrame = video.getVideoPlaybackQuality?.().totalVideoFrames;
        let frame = capture(),
          result;
        if (automatic) {
          await delay(0);
          if (cancelled()) return;
          stage = "recognition";
          await recognition.decodeFrame(frame);
          if (cancelled()) return;
          result = await reader.read(frame, frame._capturedAt, {
            report: false,
            forceMap,
          });
          if (cancelled()) return;
          if (result?.retry) {
            await delay(250);
            if (cancelled()) return;
            const fresh =
              Number.isFinite(firstFrame) && firstFrame > 0
                ? video.getVideoPlaybackQuality?.().totalVideoFrames >
                  firstFrame
                : video.currentTime !== firstTime;
            if (fresh) {
              const prior = frame;
              frame = capture();
              prior.width = 0;
              prior.height = 0;
              delete prior._pixels;
              stage = "retry recognition";
              await recognition.decodeFrame(frame);
              if (cancelled()) return;
            }
          }
        }
        if (debug || !automatic) {
          stage = "preview";
          await view.previewFrame(frame, cancelled);
          if (cancelled()) return;
        }
        if (automatic && !result?.accepted)
          await reader.read(frame, frame._capturedAt);
        if (automatic && onFrame && !skipItems && !itemTask && !cancelled()) {
          // Item OCR owns this frame until it finishes. It never holds the EXP
          // scheduler or changes an EXP result, even if its worker fails/stalls.
          canvases.splice(canvases.indexOf(frame), 1);
          itemTask = Promise.resolve()
            .then(() => {
              if (!cancelled()) return onFrame(frame, frame._capturedAt, cancelled);
            })
            .catch(() => {
              /* Item failures belong to the item panel, not EXP capture status. */
            })
            .finally(() => {
              frame.width = 0;
              frame.height = 0;
              delete frame._pixels;
              itemTask = null;
            });
        }
      } catch (error) {
        if (run === generation) {
          view.captureError(stage, error);
          if (debug) {
            const failed = canvases.findLast(
              (frame) => frame.width > 0 && frame.height > 0,
            );
            if (failed)
              try {
                await debugTools.rejectFrame(
                  failed,
                  failed._capturedAt,
                  "capture-" + stage + "-error",
                );
              } catch (downloadError) {
                view.appendOutput(
                  "Could not save diagnostic frame: " +
                    (downloadError?.message || String(downloadError)),
                );
              }
          }
        }
      } finally {
        for (const frame of canvases) {
          frame.width = 0;
          frame.height = 0;
          delete frame._pixels;
        }
        busy = false;
        if (debug && run === generation)
          view.timing(now() - started, capturedCount);
      }
    }
    function pollMapHeader() {
      if (
        session.state.paused ||
        busy ||
        reader.busy ||
        !stream ||
        video.readyState < 2 ||
        !video.videoWidth ||
        !view.isAutomatic?.() ||
        !reader.observeMapProbe
      ) return;
      const run = generation,
        width = Math.max(1, Math.round(video.videoWidth * MAP_PROBE_SCALE)),
        height = Math.max(1, Math.round(video.videoHeight * MAP_PROBE_SCALE));
      if (!mapProbeCanvas) mapProbeCanvas = document.createElement("canvas");
      if (width !== mapProbeWidth || height !== mapProbeHeight) {
        mapProbeCanvas.width = mapProbeWidth = width;
        mapProbeCanvas.height = mapProbeHeight = height;
      }
      let pixels;
      try {
        const context = mapProbeCanvas.getContext("2d");
        context.drawImage(
          video,
          0,
          0,
          video.videoWidth,
          video.videoHeight,
          0,
          0,
          width,
          height,
        );
        pixels = context.getImageData(0, 0, width, height);
      } catch {
        return;
      }
      if (
        run === generation &&
        reader.observeMapProbe(pixels) &&
        !busy &&
        !reader.busy
      ) void captureFrame(false, true, true);
    }
    function pollDropFeed() {
      if (
        session.state.paused ||
        !stream ||
        video.readyState < 2 ||
        !video.videoWidth ||
        !view.isAutomatic?.() ||
        !reader.observeDropProbe ||
        !reader.readDropNotice ||
        video.currentTime === lastDropVideoTime
      ) return;
      lastDropVideoTime = video.currentTime;
      const sourceX = Math.round(video.videoWidth * DROP_FEED_REGION.x),
        sourceY = Math.round(video.videoHeight * DROP_FEED_REGION.y),
        sourceWidth = Math.max(
          1,
          Math.min(
            video.videoWidth - sourceX,
            Math.round(video.videoWidth * DROP_FEED_REGION.w),
          ),
        ),
        sourceHeight = Math.max(
          1,
          Math.min(
            video.videoHeight - sourceY,
            Math.round(video.videoHeight * DROP_FEED_REGION.h),
          ),
        ),
        width = Math.max(1, Math.round(sourceWidth * DROP_FEED_SCALE)),
        height = Math.max(1, Math.round(sourceHeight * DROP_FEED_SCALE));
      if (!dropProbeCanvas) dropProbeCanvas = document.createElement("canvas");
      if (width !== dropProbeWidth || height !== dropProbeHeight) {
        dropProbeCanvas.width = dropProbeWidth = width;
        dropProbeCanvas.height = dropProbeHeight = height;
      }
      let probe;
      try {
        const context = dropProbeCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        context.drawImage(
          video,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          width,
          height,
        );
        probe = context.getImageData(0, 0, width, height);
      } catch {
        return;
      }
      if (!reader.observeDropProbe(probe)) return;
      if (!dropImageCanvas) dropImageCanvas = document.createElement("canvas");
      if (
        dropImageCanvas.width !== sourceWidth ||
        dropImageCanvas.height !== sourceHeight
      ) {
        dropImageCanvas.width = sourceWidth;
        dropImageCanvas.height = sourceHeight;
      }
      try {
        const context = dropImageCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        context.drawImage(
          video,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
        );
        const image = context.getImageData(0, 0, sourceWidth, sourceHeight);
        void reader.readDropNotice(image, now());
      } catch {
        /* A drop-feed probe never interrupts EXP or map recognition. */
      }
    }
    async function downloadCurrentFrame() {
      if (!debug) return false;
      if (!stream || video.readyState < 2 || !video.videoWidth) {
        view.appendOutput("Start screen sharing before downloading a screenshot.");
        return false;
      }
      const frame = document.createElement("canvas");
      frame.width = video.videoWidth;
      frame.height = video.videoHeight;
      frame.getContext("2d").drawImage(video, 0, 0);
      const timestamp = now();
      try {
        const blob = await new Promise((resolve, reject) => {
          try {
            frame.toBlob(resolve, "image/png");
          } catch (error) {
            reject(error);
          }
        });
        if (!blob) throw new Error("The browser could not encode the frame as PNG.");
        debugTools.downloadManualFrame(blob, timestamp);
        return true;
      } catch (error) {
        view.appendOutput(
          "Could not save screenshot: " + (error?.message || String(error)),
        );
        return false;
      } finally {
        frame.width = 0;
        frame.height = 0;
      }
    }
    async function connect() {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        view.status(
          "error",
          "Screen sharing is unavailable here. Open this page in Chrome or Edge using HTTPS or localhost.",
        );
        return;
      }
      connecting = true;
      view.update();
      let pending = null;
      try {
        pending = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: "window",
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: 5, max: 10 },
          },
          audio: false,
        });
        stop();
        stream = pending;
        const run = generation;
        video.srcObject = pending;
        await video.play();
        if (run !== generation) return;
        pending.getVideoTracks()[0].addEventListener(
          "ended",
          () => {
            if (stream === pending) stop();
          },
          { once: true },
        );
        session.state.running = true;
        session.state.source = "GAME WINDOW SHARED";
        session.state.startAt ||= now();
        view.status("waiting", "Reading your game window…");
        view.update();
        timer = timers.setInterval(captureFrame, FULL_SCAN_INTERVAL_MS);
        // The small visual probe only triggers OCR after a stable title change.
        mapTimer = timers.setInterval(pollMapHeader, MAP_HEADER_POLL_INTERVAL_MS);
        dropFeedTimer = timers.setInterval(
          pollDropFeed,
          DROP_FEED_POLL_INTERVAL_MS,
        );
        await captureFrame();
      } catch (error) {
        if (pending) stop();
        view.status(
          "waiting",
          error.name === "NotAllowedError"
            ? "Screen sharing was cancelled or blocked. Click Share game window to try again."
            : "Could not start screen sharing: " + error.message,
        );
      } finally {
        connecting = false;
        view.update();
      }
    }
    function togglePause() {
      if (!stream) return;
      session.state.paused = !session.state.paused;
      session.state.running = !session.state.paused;
      invalidate();
      view.status(
        "waiting",
        session.state.paused
          ? "Session paused · readings are saved. Resume when ready."
          : "Resuming session · waiting for fresh readings",
      );
      view.update();
      if (!session.state.paused) captureFrame();
    }
    return {
      connect,
      stop,
      captureFrame,
      downloadCurrentFrame,
      togglePause,
      invalidate,
      get stream() {
        return stream;
      },
      get generation() {
        return generation;
      },
      get busy() {
        return busy;
      },
      get connecting() {
        return connecting;
      },
    };
  }
  return { create };
});
