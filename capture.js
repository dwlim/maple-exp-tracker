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
    let stream = null,
      timer = null,
      generation = 0,
      busy = false,
      connecting = false,
      itemTask = null;
    const delay = (ms) =>
      new Promise((resolve) => timers.setTimeout(resolve, ms));
    function invalidate() {
      generation++;
      session.clearPending();
      onInvalidate();
    }
    function stop() {
      invalidate();
      timers.clearInterval(timer);
      timer = null;
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
    async function captureFrame(force = false) {
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
        if (automatic && onFrame && !itemTask && !cancelled()) {
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
        timer = timers.setInterval(captureFrame, 10000);
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
