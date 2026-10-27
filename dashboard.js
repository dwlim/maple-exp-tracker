(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleDashboard = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  function create({
    document,
    window,
    session,
    recognition,
    localOcr,
    getCapture,
    debug = false,
    now: clock = Date.now,
  }) {
    const q = (s) => document.querySelector(s),
      { state, samples, save } = session,
      { required, totalExp } = session.math;
    const fmt = (n) => Math.round(n || 0).toLocaleString("en-US"),
      setTimeout = window.setTimeout.bind(window);
    const currentRegions = (image) => recognition.currentRegions(image);
    let selecting = null,
      dragStart = null,
      dragCurrent = null;
    function update() {
      const captureStream = getCapture()?.stream;
      const ss = samples(),
        now = clock(),
        old = ss[0],
        latest = ss[ss.length - 1];
      let base = ss.filter((s) => s.t >= now - 300000)[0];
      if (!base && latest && latest.t >= now - 300000) base = old;
      let rate = 0;
      if (
        base &&
        latest &&
        latest.t > base.t &&
        totalExp(latest) >= totalExp(base)
      )
        rate =
          (totalExp(latest) - totalExp(base)) / ((latest.t - base.t) / 3600000);
      if (state.level !== null) {
        q("#level").textContent = state.level;
        q("#classLabel").textContent = "CHARACTER TRACKING";
      } else q("#level").textContent = "—";
      const gained =
        old && latest ? Math.max(0, totalExp(latest) - totalExp(old)) : 0;
      q("#gained").textContent = fmt(gained);
      q("#rate").textContent = rate ? fmt(rate) : "—";
      q("#pace").textContent = rate ? fmt(rate / 12) + " / 5m" : "—";
      q("#rateHint").textContent =
        ss.length < 2
          ? "Waiting for more samples"
          : "Based on trailing 5 minutes";
      if (ss.some((s) => s.estimated)) {
        if (rate) {
          q("#rate").textContent = "~" + fmt(rate);
          q("#pace").textContent = "~" + fmt(rate / 12) + " / 5m";
        }
        if (gained) q("#gained").textContent = "~" + fmt(gained);
        q("#rateHint").textContent = "Estimated from rounded HUD percentages";
      }
      const mesoSamples = (state.mesoSamples || [])
          .filter((s) => Number.isSafeInteger(s.amount) && Number.isFinite(s.t) && s.t <= now)
          .sort((a, b) => a.t - b.t),
        firstMeso = mesoSamples[0],
        latestMeso = mesoSamples.at(-1),
        mesoBase = mesoSamples.find((s) => s.t >= now - 300000) || firstMeso,
        mesoNet = firstMeso && latestMeso ? latestMeso.amount - firstMeso.amount : 0,
        mesoElapsed = latestMeso && mesoBase ? latestMeso.t - mesoBase.t : 0,
        mesoRate = mesoElapsed >= 60000
          ? ((latestMeso.amount - mesoBase.amount) * 3600000) / mesoElapsed
          : 0;
      if (q("#mesoAmount")) q("#mesoAmount").textContent = latestMeso ? fmt(latestMeso.amount) : "—";
      if (q("#mesoNet"))
        q("#mesoNet").textContent = latestMeso
          ? (mesoNet > 0 ? "+" : mesoNet < 0 ? "−" : "") + fmt(Math.abs(mesoNet))
          : "—";
      if (q("#mesoRate"))
        q("#mesoRate").textContent = mesoElapsed >= 60000
          ? (mesoRate > 0 ? "+" : mesoRate < 0 ? "−" : "") + fmt(Math.abs(mesoRate))
          : "—";
      if (q("#mesoHint"))
        q("#mesoHint").textContent = latestMeso && now - latestMeso.t > 120000
          ? "No recent meso read"
          : state.mesoStatus || "Keep inventory open to read mesos";
      const lvl = state.level,
        req = lvl ? required(lvl) : 0,
        expIn = latest ? latest.exp || 0 : 0,
        pct = req ? Math.max(0, Math.min(100, (expIn / req) * 100)) : 0;
      q("#progressFill").style.width = pct + "%";
      q("#percent").textContent = pct.toFixed(2) + "% to next level";
      q("#remaining").textContent = req
        ? fmt(Math.max(0, req - expIn)) + " EXP TO GO"
        : "— EXP TO GO";
      if (lvl >= 100) {
        q("#eta").textContent = "MAX LEVEL";
        q("#etaNote").textContent = "Level cap";
      } else if (req && rate > 0) {
        const ms = Math.max(0, ((req - expIn) / rate) * 3600000);
        q("#eta").textContent =
          ms < 60000
            ? "under 1 min"
            : ms < 3600000
              ? Math.round(ms / 60000) + " min"
              : Math.floor(ms / 3600000) +
                "h " +
                Math.round((ms % 3600000) / 60000) +
                "m";
        q("#etaNote").textContent = ss.some((s) => s.estimated)
          ? "at estimated pace"
          : "at current pace";
      } else {
        q("#eta").textContent = "—";
        q("#etaNote").textContent =
          ss.length < 2 ? "Need more data" : "No recent EXP gain";
      }
      if (q("#nextLevelEta")) {
        q("#nextLevelEta").textContent = q("#eta").textContent;
        q("#nextLevelEtaHint").textContent = q("#etaNote").textContent;
      }
      q("#shareGameBtn").disabled = !!getCapture()?.connecting;
      q("#shareGameBtn").classList.toggle("hidden", !!captureStream);
      q("#stopSharingBtn").classList.toggle("hidden", !captureStream);
      q("#sharePreview").classList.toggle("hidden", !captureStream);
      const downloadFrameButton = q("#downloadCurrentFrame");
      if (downloadFrameButton) downloadFrameButton.disabled = !captureStream;
      const pauseButton = q("#pauseSessionBtn");
      if (pauseButton) {
        pauseButton.classList.toggle("hidden", !captureStream);
        pauseButton.textContent = state.paused
          ? "Resume session"
          : "Pause session";
        pauseButton.setAttribute?.(
          "aria-pressed",
          String(Boolean(state.paused)),
        );
      }
      q("#sampleCount").textContent =
        ss.length + " sample" + (ss.length === 1 ? "" : "s");
      q("#liveState").textContent = state.paused
        ? "PAUSED"
        : state.running
          ? "TRACKING"
          : "READY";
      q("#sourceState").textContent = state.source || "NOT CONNECTED";
      q("#sourceState").style.color = state.source ? "var(--lime)" : "";
      if (state.startAt) {
        let sec = Math.floor((now - state.startAt) / 1000);
        q("#sessionTime").textContent = [
          Math.floor(sec / 3600),
          Math.floor((sec % 3600) / 60),
          sec % 60,
        ]
          .map((n) => String(n).padStart(2, "0"))
          .join(":");
      }
      q("#lastSample").textContent = latest
        ? "LAST CAPTURE · " +
          new Date(latest.t).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "NO CAPTURE YET";
      draw(ss);
      drawLog(ss);
      updateRateHint(ss);
      save();
    }
    function updateRateHint(ss = samples()) {
      const captureStream = getCapture()?.stream;
      const status = q("#trackingStatus"),
        kind = status?.dataset?.state;
      let text;
      if (kind === "error" || kind === "waiting") text = status.textContent;
      else if (!ss.length)
        text = captureStream
          ? "Waiting for the first accepted reading"
          : "Share your game window to start";
      else if (ss.length === 1)
        text = captureStream
          ? "1 reading saved · waiting for the next capture"
          : "Resume sharing to collect another reading";
      else
        text = ss.some((s) => s.estimated)
          ? "Estimated from rounded HUD percentages"
          : "Based on trailing 5 minutes";
      q("#rateHint").textContent = text;
    }
    function draw(ss) {
      const key =
        ss.length +
        ":" +
        ss[0]?.t +
        ":" +
        ss.at(-1)?.t +
        ":" +
        ss.at(-1)?.exp +
        ":" +
        ss.at(-1)?.level;
      if (draw.lastKey === key) return;
      draw.lastKey = key;
      const g = q("#chartContent");
      g.innerHTML = "";
      if (ss.length < 2) {
        g.innerHTML =
          '<text class="empty" x="350" y="88" text-anchor="middle">Your EXP curve will appear after a couple of captures</text>';
        return;
      }
      let vals = ss.map(totalExp),
        min = Math.min(...vals),
        max = Math.max(...vals);
      if (max === min) max = min + 1;
      const x = (i) => 30 + (i / (ss.length - 1)) * 650,
        y = (v) => 142 - ((v - min) / (max - min)) * 112;
      for (let k = 0; k < 4; k++) {
        let yy = 30 + k * 37;
        g.insertAdjacentHTML(
          "beforeend",
          `<line class="gridline" x1="30" y1="${yy}" x2="690" y2="${yy}"/>`,
        );
      }
      let path = ss
          .map((s, i) => (i ? "L" : "M") + x(i) + " " + y(totalExp(s)))
          .join(" "),
        area = path + ` L 680 148 L 30 148 Z`;
      g.insertAdjacentHTML(
        "beforeend",
        `<path class="area" d="${area}"/><path class="line" d="${path}"/><circle class="dot" cx="${x(ss.length - 1)}" cy="${y(vals.at(-1))}" r="4"/><text x="30" y="164">${new Date(ss[0].t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text><text x="690" y="164" text-anchor="end">${new Date(ss.at(-1).t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>`,
      );
    }
    function drawLog(ss) {
      const key = ss
        .slice(-4)
        .map(
          (s) => s.t + ":" + s.level + ":" + s.exp + ":" + Boolean(s.estimated),
        )
        .join("|");
      if (drawLog.lastKey === key) return;
      drawLog.lastKey = key;
      q("#logList").innerHTML =
        ss
          .slice(-4)
          .reverse()
          .map(
            (s) =>
              `<div class="log-item"><span>${new Date(s.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><b>Lv. ${s.level} · ${s.estimated ? "≈ " : ""}${fmt(s.exp)} EXP</b><span>capture</span></div>`,
          )
          .join("") ||
        '<div class="log-item"><span>—</span><b>No captures yet</b><span>—</span></div>';
    }
    function notice(s) {
      q("#notice").textContent = s;
      q("#notice").classList.add("show");
      setTimeout(() => q("#notice").classList.remove("show"), 4500);
    }

    function beginRegionSelection(name) {
      if (name !== "meso" && state.calibration.auto !== false)
        state.calibration = { ...currentRegions(), auto: false };
      selecting = selecting === name ? null : name;
      document.body.classList.toggle("meso-selecting", selecting === "meso");
      dragStart = dragCurrent = null;
      updateRegionStatus();
      drawRegions();
    }

    function updateRegionStatus() {
      const automatic = state.calibration?.auto !== false;
      const regions = currentRegions(),
        l = regions?.level,
        e = regions?.exp;
      q("#regionStatus").textContent =
        `${automatic ? "Auto regions" : "Custom regions"} · Level ${l ? "ready" : "unset"} · EXP ${e ? "ready" : "unset"} · Meso ${state.mesoAnchor ? "anchored" : state.mesoRegion ? "fixed region" : "unset"}${selecting ? ` · Drag to select ${selecting}${selecting === "meso" ? " the full white amount field" : ""}` : ""}`;
      q("#pickLevel")?.classList.toggle("active", selecting === "level");
      q("#pickExp")?.classList.toggle("active", selecting === "exp");
      q("#pickMeso")?.classList.toggle("active", selecting === "meso");
    }
    function drawRegions() {
      if (!debug && selecting !== "meso") return;
      const canvas = q("#frameCanvas"),
        img = q("#latestFrame");
      if (!canvas || !img || !img.naturalWidth) return;
      const ctx = canvas.getContext("2d");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const colors = { level: "#c7f36b", exp: "#a995ff", meso: "#ffd479" };
      const regions = currentRegions(img);
      for (const name of debug ? ["level", "exp", "meso"] : ["meso"]) {
        const r = name === "meso" ? state.mesoRegion : regions[name];
        if (!r) continue;
        const x = r.x * canvas.width,
          y = r.y * canvas.height,
          w = r.w * canvas.width,
          h = r.h * canvas.height;
        ctx.fillStyle = colors[name] + "22";
        ctx.strokeStyle = colors[name];
        ctx.lineWidth = Math.max(3, canvas.width / 600);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.font = `bold ${Math.max(18, canvas.width / 55)}px sans-serif`;
        ctx.fillStyle = colors[name];
        ctx.fillText(
          name === "level" ? "LEVEL" : name === "exp" ? "EXP" : "MESO TOTAL",
          x + 4,
          Math.max(18, y - 5),
        );
      }
      if (dragStart && dragCurrent && selecting) {
        const x = Math.min(dragStart.x, dragCurrent.x) * canvas.width,
          y = Math.min(dragStart.y, dragCurrent.y) * canvas.height,
          w = Math.abs(dragStart.x - dragCurrent.x) * canvas.width,
          h = Math.abs(dragStart.y - dragCurrent.y) * canvas.height;
        ctx.strokeStyle = colors[selecting];
        ctx.lineWidth = Math.max(3, canvas.width / 600);
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    }

    function output(text) {
      q("#ocrOutput").textContent = text;
    }
    function appendOutput(text) {
      q("#ocrOutput").textContent += "\n" + text;
    }
    function status(kind, text) {
      const el = q("#trackingStatus");
      if (el) {
        el.dataset.state = kind;
        el.textContent = text;
      }
      updateRateHint();
    }
    function renderReading(result, levelResult, expResult, readAt) {
      const {
        levelMatch,
        expToken,
        pctToken,
        exp,
        pct,
        confidence,
        requiredExp,
        computedPct,
        levelResolution,
        valid,
        rejectionReason,
      } = result;
      output(
        `Level OCR: ${levelMatch?.[0] || "not found"} · EXP OCR: ${expToken || (expResult.percentageOnly ? "~" + fmt(exp) : "not found")}${pctToken ? ` (${pctToken}%)` : ""} · confidence ${confidence}%` +
          (pct !== null && requiredExp
            ? ` · calculated ${computedPct.toFixed(2)}%`
            : "") +
          (levelResolution.source === "exp" ? " · level from EXP" : "") +
          (expResult.percentageOnly ? " · EXP estimated from percentage" : "") +
          (valid ? " · accepted" : " · needs review") +
          "\nRaw level: " +
          levelResult.data.text.trim() +
          " | EXP glyphs: " +
          expResult.data.text.trim(),
      );
      status(
        valid ? "ok" : "waiting",
        valid
          ? "Tracking · Last read " + new Date(readAt).toLocaleTimeString()
          : rejectionReason,
      );
    }
    function saved(t) {
      appendOutput("Saved " + new Date(t).toLocaleTimeString() + " sample.");
    }
    function reading(active) {
      q("#readFrame").disabled = active;
      if (active)
        output("Reading locally (first fallback may download OCR files)…");
    }
    function captureError(stage, error) {
      const detail = error?.message || String(error);
      status(
        "error",
        "Could not read the shared window · " + stage + ": " + detail,
      );
      output("Capture failed during " + stage + ": " + detail);
    }
    function timing(ms, count) {
      appendOutput(
        "Capture + OCR: " +
          (ms / 1000).toFixed(2) +
          " s (" +
          count +
          " frame" +
          (count === 1 ? "" : "s") +
          ")",
      );
    }
    function showExpPreview(pixels) {
      const canvas = document.createElement("canvas");
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      canvas
        .getContext("2d")
        .putImageData(
          new window.ImageData(pixels.data, pixels.width, pixels.height),
          0,
          0,
        );
      let preview = q("#expGlyphPreview");
      if (!preview) {
        preview = document.createElement("img");
        preview.id = "expGlyphPreview";
        preview.alt = "Exact EXP crop used by the digit matcher";
        preview.style.cssText =
          "display:block;max-width:100%;height:56px;object-fit:contain;object-position:left;image-rendering:pixelated;margin:10px 4px";
        q("#ocrOutput").after(preview);
      }
      preview.src = canvas.toDataURL();
      canvas.width = 0;
      canvas.height = 0;
    }
    async function previewFrame(frame, cancelled = () => false) {
      const image = q("#latestFrame"),
        blob = await new Promise((resolve) =>
          frame.toBlob(resolve, "image/png"),
        );
      if (!blob || cancelled()) return;
      frame._pngBlob = blob;
      const url = window.URL.createObjectURL(blob),
        prior = image.dataset.url;
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = url;
        });
      } catch (error) {
        window.URL.revokeObjectURL(url);
        throw error;
      }
      if (prior) window.URL.revokeObjectURL(prior);
      image.dataset.url = url;
      if (cancelled()) return;
      if (frame._hudRegions) {
        image._autoRegions = frame._hudRegions;
        image._autoRegionSource = image.src;
        image._trackedHud = {
          ...frame._hudRegions,
          width: frame.width,
          height: frame.height,
        };
      }
      image.classList.remove("hidden");
      q("#frameStage").style.display = "inline-block";
      q("#frameEmpty").classList.add("hidden");
      q("#frameStatus").textContent =
        "CAPTURE · " + new Date(frame._capturedAt).toLocaleTimeString();
      drawRegions();
      updateRegionStatus();
    }
    function bindCalibration() {
      q("#pickLevel")?.addEventListener("click", () =>
        beginRegionSelection("level"),
      );
      q("#pickExp")?.addEventListener("click", () =>
        beginRegionSelection("exp"),
      );
      q("#pickMeso")?.addEventListener("click", () =>
        beginRegionSelection("meso"),
      );
      q("#setMesoRegion")?.addEventListener("click", () =>
        beginRegionSelection("meso"),
      );
      q("#clearMeso")?.addEventListener("click", () => {
        state.mesoRegion = null;
        state.mesoAnchor = null;
        selecting = dragStart = dragCurrent = null;
        document.body.classList.remove("meso-selecting");
        save();
        updateRegionStatus();
        drawRegions();
      });
      q("#clearRegions")?.addEventListener("click", () => {
        state.calibration = { level: null, exp: null, auto: true };
        selecting = dragStart = dragCurrent = null;
        recognition.reset();
        save();
        updateRegionStatus();
        drawRegions();
      });
      const canvas = q("#frameCanvas");
      if (!canvas) return;
      const position = (e) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
          y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
        };
      };
      canvas.addEventListener("pointerdown", (e) => {
        if (!selecting) return;
        dragStart = position(e);
        dragCurrent = dragStart;
        canvas.setPointerCapture(e.pointerId);
        drawRegions();
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!dragStart) return;
        dragCurrent = position(e);
        drawRegions();
      });
      canvas.addEventListener("pointerup", (e) => {
        if (!dragStart || !selecting) return;
        dragCurrent = position(e);
        const x = Math.min(dragStart.x, dragCurrent.x),
          y = Math.min(dragStart.y, dragCurrent.y),
          w = Math.abs(dragStart.x - dragCurrent.x),
          h = Math.abs(dragStart.y - dragCurrent.y);
        if (w > 0.005 && h > 0.005) {
          if (selecting === "meso") {
            state.mesoRegion = { x, y, w, h };
            state.mesoAnchor = null;
            try {
              const image = q("#latestFrame"),
                pixelsCanvas = document.createElement("canvas");
              pixelsCanvas.width = image.naturalWidth;
              pixelsCanvas.height = image.naturalHeight;
              const ctx = pixelsCanvas.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(image, 0, 0);
              state.mesoAnchor = localOcr?.createMesoAnchor(
                ctx.getImageData(0, 0, pixelsCanvas.width, pixelsCanvas.height),
                state.mesoRegion,
              ) || null;
              pixelsCanvas.width = 0;
              pixelsCanvas.height = 0;
            } catch {}
            state.mesoStatus = state.mesoAnchor
              ? "Inventory anchor saved · aligning total automatically"
              : "Amount area saved · template unavailable, using fixed position";
          }
          else state.calibration[selecting] = { x, y, w, h };
        }
        selecting = dragStart = dragCurrent = null;
        document.body.classList.remove("meso-selecting");
        save();
        updateRegionStatus();
        drawRegions();
      });
    }
    function dispose() {
      const image = q("#latestFrame");
      if (image?.dataset?.url) {
        window.URL.revokeObjectURL(image.dataset.url);
        delete image.dataset.url;
      }
    }
    return {
      update,
      updateRateHint,
      status,
      output,
      appendOutput,
      renderReading,
      saved,
      reading,
      captureError,
      timing,
      showExpPreview,
      previewFrame,
      notice,
      bindCalibration,
      updateRegionStatus,
      drawRegions,
      dispose,
      isAutomatic: () => q("#autoOcr").checked,
    };
  }
  return { create };
});
