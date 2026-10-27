(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./session"),
      require("./recognition"),
      require("./reader"),
      require("./capture"),
      require("./dashboard"),
      require("./debug-tools"),
      require("./stream-card"),
      require("./quickslots"),
    );
  else
    root.MapleApp = factory(
      root.MapleSession,
      root.MapleRecognition,
      root.MapleReader,
      root.MapleCapture,
      root.MapleDashboard,
      root.MapleDebugTools,
      root.MapleStreamCard,
      root.MapleQuickslots,
    );
})(
  typeof window === "undefined" ? globalThis : window,
  function (
    Session,
    Recognition,
    Reader,
    Capture,
    Dashboard,
    DebugTools,
    StreamCard,
    Quickslots,
  ) {
    "use strict";
    function mount({
      document,
      window,
      navigator,
      storage,
      location,
      levelOcr,
      hudOcr,
      hudRegions,
      localOcr,
    }) {
      const params = new URLSearchParams(location.search),
        debug = params.get("debug") === "1",
        q = (s) => document.querySelector(s),
        key = "maple-track-v1";
      document.body.classList.toggle("debug", debug);
      if (params.get("stream") === "1") {
        StreamCard.mount({
          document,
          window,
          storage,
          key,
          required: Session.required,
          totalExp: Session.totalExp,
        });
        return { dispose() {} };
      }
      const mesoReference = localOcr?.loadMesoReference?.(
        document,
        new URL("assets/meso-balance-reference.png", location.href).href,
      ) || Promise.resolve(null);
      let view, capture;
      const session = Session.create({
        storage,
        key,
        levelOcr,
        onChange: () => view?.update(),
      });
      const recognition = Recognition.create({
        document,
        state: session.state,
        levelOcr,
        hudOcr,
        hudRegions,
        localOcr,
        required: Session.required,
        getImage: () => q("#latestFrame"),
        debug,
        onExpPreview: (pixels) => view.showExpPreview(pixels),
      });
      view = Dashboard.create({
        document,
        window,
        session,
        recognition,
        localOcr,
        storage,
        getCapture: () => capture,
        debug,
      });
      const debugTools = DebugTools.create({
        document,
        URL: window.URL,
        setTimeout: window.setTimeout.bind(window),
        enabled: debug,
        isDownloadEnabled: () => q("#debugDownloads")?.checked !== false,
        onDownload: (text) => {
          const el = q("#debugDownloadStatus");
          if (el) el.textContent = text;
        },
      });
      const reader = Reader.create({
        session,
        recognition,
        view,
        debugTools,
        getCapture: () => capture,
        localOcr,
        getMesoReference: () => mesoReference,
        debug,
      });
      const items = Quickslots.mount({
        document,
        window,
        video: q("#sharePreview"),
        onRejectedFrame: debug ? debugTools.rejectFrame : null,
        storage,
        getCapture: () => capture,
      });
      capture = Capture.create({
        navigator,
        video: q("#sharePreview"),
        document,
        session,
        recognition,
        reader,
        view,
        debugTools,
        debug,
        onFrame: items.process,
        onInvalidate: items.invalidate,
        timers: {
          setTimeout: window.setTimeout.bind(window),
          setInterval: window.setInterval.bind(window),
          clearInterval: window.clearInterval.bind(window),
        },
      });
      const on = (id, fn) => q(id)?.addEventListener("click", fn);
      on("#shareGameBtn", capture.connect);
      on("#stopSharingBtn", capture.stop);
      on("#readFrame", () => capture.captureFrame(true));
      on("#downloadCurrentFrame", () => capture.downloadCurrentFrame());
      on("#pauseSessionBtn", capture.togglePause);
      const manual = () => {
        const level = window.prompt("Character level (for example, 52):");
        if (level === null) return;
        const exp = window.prompt(
          "EXP gained within this level (for example, 542829):",
        );
        if (exp === null) return;
        if (!session.addSample(Number(level), Number(exp)))
          view.notice(
            "Enter a level from 1 to 100 and current-level EXP within that level’s requirement.",
          );
      };
      on("#manualBtn", manual);
      on("#sampleBtn", () => {
        if (!session.state.samples.length) manual();
        else view.notice("Use Manual entry to add a sample.");
      });
      on("#newSessionBtn", () => {
        if (
          !window.confirm(
            "Start a new session and clear the current session readings?",
          )
        )
          return;
        capture.invalidate();
        session.reset();
        items.resetSession();
        view.status("waiting", "New session · Waiting for the next reading");
      });
      on("#streamCardBtn", () => {
        const url = new URL(location.href);
        url.search = "?stream=1";
        const card = window.open(
          url.href,
          "maple-track-stream-card",
          "popup=yes,width=420,height=410",
        );
        if (card) card.focus();
        else
          view.notice(
            "Allow popups for Maple Track, then click Open stream card again.",
          );
      });
      view.bindCalibration();
      view.updateRegionStatus();
      view.update();
      const timer = window.setInterval(() => {
        view.update();
        items.render();
      }, 5000);
      let disposed = false;
      function dispose() {
        if (disposed) return;
        disposed = true;
        window.clearInterval(timer);
        if (capture.stream) capture.stop();
        view.dispose();
        items.dispose();
        window.removeEventListener("pagehide", dispose);
      }
      window.addEventListener("pagehide", dispose, { once: true });
      return { session, recognition, reader, capture, view, items, dispose };
    }
    return { mount };
  },
);
