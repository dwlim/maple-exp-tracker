(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./quickslot-ocr"),
      require("./hud-regions"),
      require("./quickslot-session"),
    );
  else
    root.MapleQuickslots = factory(
      root.MapleQuickslotOcr,
      root.MapleHudRegions,
      root.MapleQuickslotSession,
    );
})(
  typeof window === "undefined" ? globalThis : window,
  function (Ocr, Regions, Session) {
    "use strict";
    function mount({
      document,
      window,
      video,
      storage,
      getCapture,
      now = Date.now,
    }) {
      const q = (id) => document.querySelector(id);
      if (!q("#quickslotItems"))
        return {
          process: async () => {},
          invalidate() {},
          resetSession() {},
          render() {},
          dispose() {},
        };
      let renderedRows = "",
        revision = 0;
      let draft = null,
        editing = null,
        origin = null,
        selection = null,
        disposed = false,
        busy = false,
        previewBase = null;
      let worker = null,
        waiter = null,
        workId = 0,
        workerFailed = false,
        fault = "";
      function stopWorker() {
        if (waiter) {
          window.clearTimeout(waiter.timer);
          waiter.resolve(null);
          waiter = null;
        }
        worker?.terminate();
        worker = null;
      }
      async function match(image) {
        if (!window?.Worker) return Ocr.recognize(image);
        if (workerFailed) return null;
        if (!worker) {
          try {
            worker = new window.Worker(
              new URL("quickslot-worker.js", window.location.href),
            );
          } catch (error) {
            workerFailed = true;
            fault = "Item worker could not start. Reload the page to retry.";
            return null;
          }
          worker.onmessage = (e) => {
            if (!waiter || e.data.id !== waiter.id) return;
            const done = waiter;
            waiter = null;
            window.clearTimeout(done.timer);
            done.resolve(e.data.result);
          };
          worker.onerror = () => {
            workerFailed = true;
            fault = "Item reader could not load. Reload the page to retry.";
            stopWorker();
          };
        }
        return new Promise((resolve) => {
          const id = ++workId,
            timer = window.setTimeout(() => {
              workerFailed = true;
              fault = "Item reading timed out. Reload the page to retry.";
              stopWorker();
            }, 3000);
          waiter = { id, resolve, timer };
          try {
            worker.postMessage({ id, image }, [image.data.buffer]);
          } catch {
            workerFailed = true;
            fault =
              "Item reader could not process the selected region. Reload to retry.";
            stopWorker();
          }
        });
      }
      const cache = new Map(),
        store = Session.create({ storage, onChange: () => render() }),
        canvas = q("#itemRegionCanvas"),
        context = () => canvas.getContext("2d");
      function restart() {
        revision++;
        stopWorker();
        cache.clear();
      }
      const number = (n) => (n === null ? "—" : Math.round(n).toLocaleString());
      function render() {
        q("#trackItems").checked = store.state.enabled;
        q("#itemTrackingState").textContent =
          fault ||
          (!store.state.enabled
            ? "Off"
            : store.state.items.length
              ? getCapture()?.stream
                ? "Every 10 seconds with your game capture"
                : "Waiting for screen sharing"
              : "Add an item to begin");
        const rowKey = JSON.stringify(
          store.state.items.map((i) => [
            i.id,
            i.label,
            i.count,
            i.used,
            number(store.rate(i)),
            i.status,
            i.at === null || now() - i.at > 25000,
          ]),
        );
        if (rowKey === renderedRows) return;
        renderedRows = rowKey;
        const body = q("#itemRows");
        body.innerHTML = "";
        for (const item of store.state.items) {
          const tr = document.createElement("tr"),
            stale = item.at === null || now() - item.at > 25000;
          for (const text of [
            item.label,
            number(item.count),
            number(item.used),
            number(store.rate(item)),
            stale && item.status === "Reading"
              ? "Waiting for a fresh count"
              : item.status,
          ]) {
            const td = document.createElement("td");
            td.textContent = text;
            tr.appendChild(td);
          }
          const td = document.createElement("td");
          for (const [label, action] of [
            ["Select count", () => setup(item)],
            [
              "Remove",
              () => {
                restart();
                store.remove(item.id);
                cache.delete(item.id);
              },
            ],
          ]) {
            const button = document.createElement("button");
            button.className = "btn";
            button.textContent = label;
            button.setAttribute("aria-label", label + " for " + item.label);
            button.addEventListener("click", action);
            td.appendChild(button);
          }
          tr.appendChild(td);
          body.appendChild(tr);
        }
        q("#itemsEmpty").hidden = store.state.items.length > 0;
      }
      function close() {
        q("#itemSetup").hidden = true;
        canvas.width = canvas.height = 0;
        if (previewBase) {
          previewBase.width = previewBase.height = 0;
        }
        previewBase = null;
        draft = selection = origin = null;
      }
      function setup(item) {
        if (
          !getCapture()?.stream ||
          video.readyState < 2 ||
          !video.videoWidth
        ) {
          q("#itemTrackingState").textContent =
            "Share your game window first, then add an item.";
          return;
        }
        if (!item && store.state.items.length >= 8) {
          q("#itemTrackingState").textContent =
            "You can track up to eight items.";
          return;
        }
        close();
        editing = item?.id || null;
        const y = Math.floor(video.videoHeight * 0.65),
          width = Math.min(1600, video.videoWidth),
          height = Math.round(
            ((video.videoHeight - y) * width) / video.videoWidth,
          );
        previewBase = document.createElement("canvas");
        previewBase.width = canvas.width = width;
        previewBase.height = canvas.height = height;
        previewBase
          .getContext("2d")
          .drawImage(
            video,
            0,
            y,
            video.videoWidth,
            video.videoHeight - y,
            0,
            0,
            width,
            height,
          );
        selection = {
          width: video.videoWidth,
          height: video.videoHeight,
          y: y / video.videoHeight,
        };
        q("#itemLabel").value = item?.label || "";
        q("#itemSetup").hidden = false;
        q("#saveItem").disabled = true;
        q("#itemSelectionHint").textContent =
          "Drag a tight box around the complete quantity digits, including their outline. Leave out the icon and key label.";
        context().drawImage(previewBase, 0, 0);
        canvas.scrollIntoView?.({ block: "nearest" });
      }
      function point(e) {
        const r = canvas.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
          y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
        };
      }
      function draw(end) {
        if (!origin || !previewBase) return;
        const box = {
          x: Math.min(origin.x, end.x),
          y: Math.min(origin.y, end.y),
          w: Math.abs(end.x - origin.x),
          h: Math.abs(end.y - origin.y),
        };
        const c = context();
        c.drawImage(previewBase, 0, 0);
        c.strokeStyle = "#d4fc79";
        c.lineWidth = 2;
        c.strokeRect(
          box.x * canvas.width,
          box.y * canvas.height,
          box.w * canvas.width,
          box.h * canvas.height,
        );
        draft = {
          x: box.x,
          y: selection.y + box.y * (1 - selection.y),
          w: box.w,
          h: box.h * (1 - selection.y),
        };
        return draft;
      }
      canvas.addEventListener("pointerdown", (e) => {
        if (!selection) return;
        origin = point(e);
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (origin) draw(point(e));
      });
      canvas.addEventListener("pointerup", (e) => {
        if (!origin) return;
        draw(point(e));
        origin = null;
        const w = draft.w * selection.width,
          h = draft.h * selection.height,
          valid = w >= 5 && h >= 8 && w <= 240 && h <= 80;
        q("#saveItem").disabled = !valid;
        q("#itemSelectionHint").textContent = valid
          ? "Count selected. Name the item and save."
          : "Select only the quantity digits: 5–240 pixels wide and 8–80 pixels tall.";
        if (!valid) draft = null;
      });
      canvas.addEventListener("pointercancel", () => {
        origin = null;
        draft = null;
        q("#saveItem").disabled = true;
      });
      q("#addItem").addEventListener("click", () => setup());
      q("#cancelItem").addEventListener("click", close);
      q("#saveItem").addEventListener("click", () => {
        if (!draft || !selection) return;
        restart();
        const item = store.add(
          q("#itemLabel").value,
          draft,
          selection.width,
          selection.height,
          editing,
        );
        if (item) {
          cache.delete(item.id);
          store.enable(true);
          close();
        } else
          q("#itemSelectionHint").textContent =
            "Enter an item name and select its quantity.";
      });
      q("#trackItems").addEventListener("change", () => {
        restart();
        workerFailed = false;
        fault = "";
        store.enable(q("#trackItems").checked);
        cache.clear();
      });
      q("#resetItems").addEventListener("click", () => {
        restart();
        store.reset();
      });
      async function process(frame, t, cancelled = () => false) {
        if (
          disposed ||
          busy ||
          !store.state.enabled ||
          !store.state.items.length ||
          cancelled()
        )
          return;
        const run = revision;
        busy = true;
        try {
          const image =
            frame._pixels ||
            frame
              .getContext("2d")
              .getImageData(0, 0, frame.width, frame.height);
          for (const item of [...store.state.items]) {
            if (
              disposed ||
              cancelled() ||
              run !== revision ||
              !store.state.enabled
            )
              return;
            if (item.width !== image.width || item.height !== image.height) {
              item.status = "Capture size changed · select count again";
              item.at = null;
              item.pending = null;
              continue;
            }
            const r = item.region,
              crop = Regions.crop(image, {
                x: r.x * image.width,
                y: r.y * image.height,
                w: r.w * image.width,
                h: r.h * image.height,
              });
            let hash = 2166136261;
            for (const v of crop.data) hash = Math.imul(hash ^ v, 16777619);
            const key = crop.width + ":" + crop.height + ":" + hash,
              prior = cache.get(item.id),
              result = prior?.key === key ? prior.result : await match(crop);
            if (
              cancelled() ||
              disposed ||
              run !== revision ||
              !store.state.enabled
            )
              return;
            cache.set(item.id, { key, result });
            if (
              cancelled() ||
              disposed ||
              run !== revision ||
              !store.state.enabled
            )
              return;
            store.observe(item.id, result, t);
          }
        } catch (error) {
          fault =
            "Item reading unavailable: " + (error.message || String(error));
        } finally {
          busy = false;
          render();
        }
      }
      render();
      return {
        store,
        process,
        render,
        invalidate() {
          restart();
          store.invalidate();
          cache.clear();
          close();
        },
        resetSession() {
          restart();
          store.reset();
        },
        dispose() {
          disposed = true;
          stopWorker();
          close();
          cache.clear();
        },
      };
    }
    return {
      createStore: Session.create,
      mount,
      validRegion: Session.validRegion,
    };
  },
);
