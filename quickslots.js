(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./quickslot-ocr"),
      require("./hud-regions"),
      require("./quickslot-session"),
      require("./quickslot-layout"),
    );
  else
    root.MapleQuickslots = factory(
      root.MapleQuickslotOcr,
      root.MapleHudRegions,
      root.MapleQuickslotSession,
      root.MapleQuickslotLayout,
    );
})(
  typeof window === "undefined" ? globalThis : window,
  function (Ocr, Regions, Session, Layout) {
    "use strict";
    const POTIONS = [
      ["red", "Red Potion"],
      ["orange", "Orange Potion"],
      ["white", "White Potion"],
      ["blue", "Blue Potion"],
      ["mana", "Mana Elixir"],
      ["meat", "Meat"],
      ["lemon", "Lemon"],
      ["hp", "Other HP potion"],
      ["mp", "Other MP potion"],
      ["both", "HP + MP potion"],
      ["other", "Other consumable"],
    ].map(([value, label]) => ({ value, label }));
    function mount({
      document,
      window,
      storage,
      getCapture,
      onRejectedFrame = null,
      now = Date.now,
    }) {
      const q = (id) => document.querySelector(id),
        profiles = new Map(),
        cards = new Map(),
        cache = new Map();
      let store = null,
        live = null,
        last = null,
        drawnKind = null,
        revision = 0,
        busy = false,
        disposed = false,
        fault = "",
        worker = null,
        waiter = null,
        serial = 0,
        workerFailed = false;
      function getStore(kind) {
        if (!profiles.has(kind))
          profiles.set(
            kind,
            Session.create({
              storage,
              key: "maple-track-items-v1:" + kind,
              onChange: () => render(),
            }),
          );
        return profiles.get(kind);
      }
      function stopWorker() {
        if (waiter) {
          window.clearTimeout(waiter.timer);
          waiter.resolve(null);
          waiter = null;
        }
        worker?.terminate();
        worker = null;
      }
      function restart() {
        revision++;
        stopWorker();
        cache.clear();
      }
      async function job(kind, image, geometry = null) {
        if (!window?.Worker)
          return kind === "layout"
            ? Layout.scan({ ...geometry, patch: image })
            : kind === "slot"
              ? Ocr.recognizeSlot(image)
              : Ocr.recognize(image);
        if (workerFailed) return null;
        if (!worker) {
          try {
            worker = new window.Worker(
              new URL("quickslot-worker.js?v=5", window.location.href),
            );
          } catch {
            workerFailed = true;
            fault = "Potion reader could not start. Reload to retry.";
            return null;
          }
          worker.onmessage = (e) => {
            if (!waiter || waiter.id !== e.data.id) return;
            const done = waiter;
            waiter = null;
            window.clearTimeout(done.timer);
            done.resolve(e.data.result);
          };
          worker.onerror = () => {
            workerFailed = true;
            fault = "Potion reader could not load. Reload to retry.";
            stopWorker();
          };
        }
        return new Promise((resolve) => {
          const id = ++serial,
            timer = window.setTimeout(() => {
              workerFailed = true;
              fault = "Potion reader timed out. Reload to retry.";
              stopWorker();
            }, 3000);
          waiter = { id, resolve, timer };
          try {
            worker.postMessage({ id, kind, image, geometry }, [
              image.data.buffer,
            ]);
          } catch {
            workerFailed = true;
            fault = "Potion reading unavailable. Reload to retry.";
            stopWorker();
          }
        });
      }
      const number = (n) =>
        n === null || n === undefined ? "—" : Math.round(n).toLocaleString();
      function assignSlot(index, type) {
        if (
          !live ||
          !store ||
          !Number.isInteger(index) ||
          index < 0 ||
          index >= live.count
        )
          return false;
        const potion = POTIONS.find((p) => p.value === type);
        if (type && !potion) return false;
        const existing = store.state.items.find((i) => i.slot === index);
        if (existing?.potionType === type) return true;
        restart();
        if (existing) store.remove(existing.id);
        if (potion) {
          const s = live.slots[index];
          store.add(potion.label, s.quantity, live.width, live.height, null, {
            slot: index,
            potionType: type,
          });
          if (!store.state.enabled) store.enable(true);
        }
        render();
        return true;
      }
      function makeGrid(layout) {
        cards.clear();
        const grid = q("#quickslotGrid");
        grid.innerHTML = "";
        grid.style.gridTemplateColumns = "repeat(4,minmax(130px,1fr))";
        for (let index = 0; index < layout.count; index++) {
          const card = document.createElement("div");
          card.className = "quickslot-card";
          const head = document.createElement("div");
          head.className = "quickslot-card-head";
          const label = document.createElement("span");
          label.textContent = "Slot " + (index + 1);
          const thumb = document.createElement("canvas");
          thumb.width = thumb.height = 48;
          thumb.setAttribute("aria-label", "Captured game slot " + (index + 1));
          head.appendChild(label);
          head.appendChild(thumb);
          card.appendChild(head);
          const select = document.createElement("select");
          select.setAttribute(
            "aria-label",
            "Potion type for slot " + (index + 1),
          );
          for (const p of [{ value: "", label: "Not tracked" }, ...POTIONS]) {
            const option = document.createElement("option");
            option.value = p.value;
            option.textContent = p.label;
            select.appendChild(option);
          }
          select.addEventListener("change", () =>
            assignSlot(index, select.value),
          );
          card.appendChild(select);
          const remaining = document.createElement("div");
          remaining.className = "quickslot-count";
          card.appendChild(remaining);
          const usage = document.createElement("div");
          usage.className = "quickslot-usage";
          card.appendChild(usage);
          const status = document.createElement("div");
          status.className = "quickslot-status";
          card.appendChild(status);
          cards.set(index, { card, thumb, select, remaining, usage, status });
          grid.appendChild(card);
        }
        drawnKind = layout.kind;
      }
      function render() {
        if (!q("#quickslotItems")) return;
        q("#trackItems").checked = store?.state.enabled === true;
        q("#trackItems").disabled = !live;
        q("#quickslotLayoutState").textContent = live
          ? live.count + " SLOTS DETECTED"
          : getCapture()?.stream
            ? "LOOKING FOR QUICKSLOTS"
            : "WAITING FOR SHARING";
        q("#itemTrackingState").textContent =
          fault ||
          (!live
            ? "Keep the quickslots and bottom HUD visible."
            : !store.state.items.length
              ? "Choose a potion type on each slot you want to track."
              : store.state.enabled
                ? "Reading selected slots every 10 seconds."
                : "Potion tracking paused.");
        const displayed = live || last;
        q("#itemsEmpty").hidden = !!displayed;
        if (!displayed) return;
        if (drawnKind !== displayed.kind) makeGrid(displayed);
        for (const [index, c] of cards) {
          const item = store?.state.items.find((i) => i.slot === index),
            type = item?.potionType || "";
          if (c.select.value !== type) c.select.value = type;
          c.select.disabled = !live;
          c.card.classList.toggle("slot-inactive", !live);
          c.remaining.textContent = item
            ? "Remaining " + number(item.count)
            : "Not tracked";
          c.usage.textContent = item
            ? "Used " +
              number(item.used) +
              " · " +
              number(store.rate(item)) +
              " / hour"
            : "";
          c.status.textContent = !live
            ? "Waiting for quickslots"
            : !item
              ? "Select potion type"
              : item.at === null || now() - item.at > 25000
                ? item.status === "Reading"
                  ? "Waiting for a fresh count"
                  : item.status
                : item.status;
        }
      }
      q("#trackItems")?.addEventListener("change", () => {
        if (!store) return;
        restart();
        workerFailed = false;
        fault = "";
        store.enable(q("#trackItems").checked);
      });
      q("#resetItems")?.addEventListener("click", () => {
        restart();
        store?.reset();
      });
      q("#rescanItems")?.addEventListener("click", () => {
        restart();
        workerFailed = false;
        fault = "";
        live = null;
        last = null;
        store?.invalidate();
        render();
        getCapture()?.captureFrame(true);
      });
      async function process(frame, t, cancelled = () => false) {
        if (disposed || busy || cancelled()) return;
        busy = true;
        let run = revision;
        const stopped = () => disposed || cancelled() || run !== revision;
        try {
          const image =
              frame._pixels ||
              frame
                .getContext("2d")
                .getImageData(0, 0, frame.width, frame.height),
            prepared = Layout.prepare(image, last);
          let found = null;
          if (prepared) {
            const { patch, ...geometry } = prepared;
            found = await job("layout", patch, geometry);
            if (stopped()) return;
          }
          if (!found) {
            live = null;
            store?.invalidate();
            render();
            return;
          }
          if (!store || last?.kind !== found.kind) {
            store?.invalidate();
            revision++;
            run = revision;
            cache.clear();
            store = getStore(found.kind);
            store.invalidate();
          }
          live = last = found;
          fault = "";
          render();
          for (const s of found.slots) {
            const c = cards.get(s.index),
              b = s.box;
            if (c)
              c.thumb
                .getContext("2d")
                .drawImage(frame, b.x, b.y, b.w, b.h, 0, 0, 48, 48);
          }
          if (!store.state.enabled) return;
          let unreadable = false;
          for (const item of [...store.state.items]) {
            if (stopped() || !store.state.enabled) return;
            const slot = found.slots[item.slot];
            if (!slot) continue;
            if (item.width !== image.width || item.height !== image.height) {
              item.at = null;
              item.pending = null;
            }
            item.width = image.width;
            item.height = image.height;
            item.region = slot.quantity;
            const r = slot.quantity,
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
              result =
                prior?.key === key ? prior.result : await job("slot", crop);
            if (stopped() || !store.state.enabled) return;
            cache.set(item.id, { key, result });
            store.observe(item.id, result, t);
            if (!Number.isInteger(result?.count) || result.confidence < 90)
              unreadable = true;
          }
          if (unreadable && !stopped()) {
            try {
              await onRejectedFrame?.(frame, t, stopped);
            } catch {
              /* Saving diagnostics must not interrupt tracking. */
            }
          }
        } catch (e) {
          fault = "Potion reading unavailable: " + (e.message || String(e));
        } finally {
          busy = false;
          render();
        }
      }
      render();
      return {
        get store() {
          return store;
        },
        get layout() {
          return live;
        },
        assignSlot,
        process,
        render,
        invalidate() {
          restart();
          live = null;
          for (const s of profiles.values()) s.invalidate();
          render();
        },
        resetSession() {
          restart();
          for (const kind of ["4x2", "4x3"]) getStore(kind).reset();
        },
        dispose() {
          disposed = true;
          restart();
        },
      };
    }
    return {
      mount,
      createStore: Session.create,
      validRegion: Session.validRegion,
      POTIONS,
    };
  },
);
