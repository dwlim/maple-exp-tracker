(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleQuickslotSession = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const KEY = "maple-track-items-v1";
  function validRegion(r) {
    return (
      r &&
      ["x", "y", "w", "h"].every((k) => Number.isFinite(r[k])) &&
      r.x >= 0 &&
      r.y >= 0 &&
      r.w > 0 &&
      r.h > 0 &&
      r.x + r.w <= 1.00001 &&
      r.y + r.h <= 1.00001
    );
  }
  function createStore({ storage, onChange = () => {} } = {}) {
    let saved;
    try {
      saved = JSON.parse(storage?.getItem(KEY) || "null");
    } catch {}
    const state = { enabled: saved?.enabled === true, items: [] },
      seen = new Map();
    let serial = 0;
    for (const v of Array.isArray(saved?.items)
      ? saved.items.slice(0, 8)
      : []) {
      if (
        !validRegion(v.region) ||
        typeof v.label !== "string" ||
        !Number.isInteger(v.width) ||
        !Number.isInteger(v.height) ||
        v.width < 1 ||
        v.height < 1
      )
        continue;
      state.items.push({
        id: ++serial,
        label: v.label.slice(0, 40),
        region: { ...v.region },
        width: v.width,
        height: v.height,
        count:
          Number.isInteger(v.count) && v.count >= 0 && v.count <= 99999
            ? v.count
            : null,
        used: Number.isFinite(v.used) && v.used >= 0 ? v.used : 0,
        seconds: Number.isFinite(v.seconds) && v.seconds >= 0 ? v.seconds : 0,
        at: null,
        pending: null,
        status: "Waiting for capture",
      });
    }
    function changed() {
      try {
        storage?.setItem(
          KEY,
          JSON.stringify({
            enabled: state.enabled,
            items: state.items.map(({ at, pending, status, ...v }) => v),
          }),
        );
      } catch {}
      onChange();
    }
    function invalidate() {
      seen.clear();
      for (const item of state.items) {
        item.at = null;
        item.pending = null;
        item.status = "Waiting for capture";
      }
      onChange();
    }
    function add(label, region, width, height, id) {
      if (
        typeof label !== "string" ||
        !label.trim() ||
        !validRegion(region) ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1
      )
        return null;
      let item = state.items.find((v) => v.id === id);
      if (!item) {
        if (state.items.length >= 8) return null;
        item = { id: ++serial, used: 0, seconds: 0 };
        state.items.push(item);
      }
      Object.assign(item, {
        label: label.trim().slice(0, 40),
        region: { ...region },
        width,
        height,
        count: null,
        at: null,
        pending: null,
        status: "Waiting for capture",
      });
      changed();
      return item;
    }
    function observe(id, result, t) {
      const item = state.items.find((v) => v.id === id);
      if (!item || !Number.isFinite(t) || (seen.has(id) && t <= seen.get(id)))
        return false;
      seen.set(id, t);
      if (
        !result ||
        !Number.isInteger(result.count) ||
        result.count < 0 ||
        result.count > 99999 ||
        !Number.isFinite(result.confidence) ||
        result.confidence < 90
      ) {
        item.pending = null;
        item.status = "Unreadable · keeping last count";
        onChange();
        return false;
      }
      const count = result.count,
        dt = item.at === null ? null : (t - item.at) / 1000;
      if (
        dt !== null &&
        dt <= 25 &&
        count !== item.count &&
        Math.abs(count - item.count) > Math.max(5, item.count * 0.05)
      ) {
        const p = item.pending,
          confirmed =
            p &&
            t > p.t &&
            t - p.t <= 25000 &&
            Math.sign(count - item.count) === Math.sign(p.count - item.count) &&
            Math.abs(count - p.count) <= Math.max(2, (t - p.t) / 1000);
        if (!confirmed) {
          item.pending = { count, t };
          item.status = "Confirming count change";
          onChange();
          return false;
        }
      }
      if (dt !== null && dt <= 25) {
        item.seconds += dt;
        item.used += Math.max(0, item.count - count);
      }
      Object.assign(item, { count, at: t, pending: null, status: "Reading" });
      changed();
      return true;
    }
    return {
      state,
      add,
      observe,
      invalidate,
      enable(v) {
        state.enabled = !!v;
        invalidate();
        changed();
      },
      remove(id) {
        state.items = state.items.filter((v) => v.id !== id);
        seen.delete(id);
        changed();
      },
      reset() {
        for (const i of state.items) {
          i.used = 0;
          i.seconds = 0;
        }
        invalidate();
        changed();
      },
      rate(item) {
        return item.seconds >= 30 ? (item.used / item.seconds) * 3600 : null;
      },
    };
  }

  return { create: createStore, validRegion };
});
