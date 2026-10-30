(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./quickslot-ocr"),
      require("./hud-regions"),
      require("./quickslot-session"),
      require("./quickslot-layout"),
      require("./potion-costs"),
      require("./quickslot-icon"),
    );
  else
    root.MapleQuickslots = factory(
      root.MapleQuickslotOcr,
      root.MapleHudRegions,
      root.MapleQuickslotSession,
      root.MapleQuickslotLayout,
      root.MaplePotionCosts,
      root.MapleQuickslotIcon,
    );
})(
  typeof window === "undefined" ? globalThis : window,
  function (Ocr, Regions, Session, Layout, Costs, Icon) {
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
        cache = new Map(),
        emptyFrames = new Map();
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
              key: Session.KEY + ":" + kind,
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
              new URL("quickslot-worker.js?v=9", window.location.href),
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
        emptyFrames.delete(index);
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
          const priceLabel = document.createElement("label");
          priceLabel.className = "quickslot-price";
          priceLabel.textContent = "Mesos / item";
          const price = document.createElement("input");
          price.type = "number";
          price.min = "0";
          price.max = "1000000000";
          price.step = "any";
          price.placeholder = "Enter price";
          price.setAttribute(
            "aria-label",
            "Mesos per item for slot " + (index + 1),
          );
          price.addEventListener("change", () => {
            const item = store?.state.items.find((i) => i.slot === index);
            if (!item) return;
            const value =
              price.value.trim() === "" ? null : Number(price.value);
            if (value !== null && !Costs.validPrice(value)) {
              price.value =
                Costs.price(item) === null ? "" : String(Costs.price(item));
              return;
            }
            store.setUnitCost(item.id, value);
            price.value =
              Costs.price(item) === null ? "" : String(Costs.price(item));
          });
          const priceHint = document.createElement("small");
          priceLabel.appendChild(price);
          priceLabel.appendChild(priceHint);
          card.appendChild(priceLabel);
          const remaining = document.createElement("div");
          remaining.className = "quickslot-count";
          card.appendChild(remaining);
          const usage = document.createElement("div");
          usage.className = "quickslot-usage";
          card.appendChild(usage);
          const status = document.createElement("div");
          status.className = "quickslot-status";
          card.appendChild(status);
          cards.set(index, {
            card,
            thumb,
            select,
            priceLabel,
            price,
            priceHint,
            remaining,
            usage,
            status,
          });
          grid.appendChild(card);
        }
        drawnKind = layout.kind;
      }
      function render() {
        if (!q("#quickslotItems")) return;
        try {
          storage?.setItem(
            Costs.KEY,
            JSON.stringify(Costs.snapshot(store, !!live, now())),
          );
        } catch {}
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
          c.priceLabel.hidden = !item || !Costs.catalog[type];
          c.price.disabled = !live;
          const price = item ? Costs.price(item) : null;
          if (document.activeElement !== c.price)
            c.price.value = price === null ? "" : String(price);
          c.priceHint.textContent =
            item?.unitCost !== null && item?.unitCost !== undefined
              ? "Custom price · clear to reset"
              : price === null
                ? "Enter your purchase price"
                : "NPC default · edit for your purchase";
          c.card.classList.toggle("slot-inactive", !live);
          c.remaining.textContent = item
            ? "Remaining " + number(item.count)
            : "Not tracked";
          c.usage.textContent = item
            ? "Used " +
              number(item.used) +
              " · " +
              number(store.rate(item, now())) +
              " / hour · 5m"
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
            emptyFrames.clear();
            live = null;
            store?.invalidate();
            render();
            return;
          }
          if (!store || last?.kind !== found.kind) {
            emptyFrames.clear();
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
          // A blank icon is expected when a tracked stack runs out. Require
          // two distinct, nearby captures before clearing to ride out effects,
          // cursor overlap, and temporary capture artifacts.
          for (const item of [...store.state.items]) {
            if (!Number.isInteger(item.slot)) continue;
            const slot = found.slots[item.slot];
            if (!slot) continue;
            if (!Icon.clearlyEmpty(image, slot.box)) {
              emptyFrames.delete(item.slot);
              continue;
            }
            const previous = emptyFrames.get(item.slot);
            if (!previous || t <= previous.t || t - previous.t > 25000) {
              emptyFrames.set(item.slot, { count: 1, t });
              continue;
            }
            if (previous.count + 1 < 2) {
              emptyFrames.set(item.slot, { count: previous.count + 1, t });
              continue;
            }
            emptyFrames.delete(item.slot);
            cache.delete(item.id);
            store.remove(item.id);
          }
          if (!store.state.enabled) return;
          const unreadableSlots = [];
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
              unreadableSlots.push(item.slot + 1);
          }
          if (unreadableSlots.length && !stopped()) {
            try {
              await onRejectedFrame?.(
                frame,
                t,
                "quickslot-unreadable-s" + unreadableSlots.slice(0, 8).join("-") +
                  (unreadableSlots.length > 8
                    ? "-plus-" + (unreadableSlots.length - 8)
                    : ""),
                stopped,
              );
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
