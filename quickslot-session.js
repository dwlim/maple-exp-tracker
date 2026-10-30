(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./potion-costs"));
  else root.MapleQuickslotSession = factory(root.MaplePotionCosts);
})(typeof window === "undefined" ? globalThis : window, function (Costs) {
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
  function createStore({ storage, key = KEY, onChange = () => {} } = {}) {
    let saved;
    try {
      saved = JSON.parse(storage?.getItem(key) || "null");
    } catch {}
    let legacySpent = 0,
      legacySpendKnown = true;
    for (const item of Array.isArray(saved?.items) ? saved.items : []) {
      const used = Number.isFinite(item?.used) && item.used > 0 ? item.used : 0,
        unitCost = Costs.price(item);
      if (!used) continue;
      if (unitCost === null) legacySpendKnown = false;
      else legacySpent += used * unitCost;
    }
    const state = {
      enabled: saved?.enabled === true,
      items: [],
      totalSpent:
        Number.isFinite(saved?.totalSpent) && saved.totalSpent >= 0
          ? saved.totalSpent
          : legacySpent,
      spendKnown:
        typeof saved?.spendKnown === "boolean"
          ? saved.spendKnown
          : legacySpendKnown,
    },
      seen = new Map();
    let serial = 0;
    for (const v of Array.isArray(saved?.items)
      ? saved.items.slice(0, 12)
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
        slot:
          Number.isInteger(v.slot) && v.slot >= 0 && v.slot < 12
            ? v.slot
            : null,
        potionType:
          typeof v.potionType === "string" ? v.potionType.slice(0, 40) : null,
        unitCost:
          Number.isFinite(v.unitCost) && v.unitCost >= 0 && v.unitCost <= 1e9
            ? v.unitCost
            : null,
        region: { ...v.region },
        width: v.width,
        height: v.height,
        count:
          Number.isInteger(v.count) && v.count >= 0 && v.count <= 99999
            ? v.count
            : null,
        used: Number.isFinite(v.used) && v.used >= 0 ? v.used : 0,
        seconds: Number.isFinite(v.seconds) && v.seconds >= 0 ? v.seconds : 0,
        usageSamples: Array.isArray(v.usageSamples)
          ? v.usageSamples.filter((s) => Number.isFinite(s?.t) && Number.isFinite(s?.seconds) && s.seconds > 0 && s.seconds <= 25 && Number.isFinite(s?.used) && s.used >= 0).slice(-200)
          : [],
        at: null,
        pending: null,
        status: "Waiting for capture",
      });
    }
    function changed() {
      try {
        storage?.setItem(
          key,
          JSON.stringify({
            enabled: state.enabled,
            totalSpent: state.totalSpent,
            spendKnown: state.spendKnown,
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
    function add(label, region, width, height, id, meta = {}) {
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
        if (state.items.length >= 12) return null;
        item = { id: ++serial, used: 0, seconds: 0, usageSamples: [] };
        state.items.push(item);
      }
      Object.assign(item, {
        label: label.trim().slice(0, 40),
        slot:
          Number.isInteger(meta.slot) && meta.slot >= 0 && meta.slot < 12
            ? meta.slot
            : null,
        potionType:
          typeof meta.potionType === "string"
            ? meta.potionType.slice(0, 40)
            : null,
        unitCost: null,
        region: { ...region },
        width,
        height,
        count: null,
        usageSamples: [],
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
        const used = Math.max(0, item.count - count);
        item.used += used;
        if (used) {
          const unitCost = Costs.price(item);
          if (unitCost === null) state.spendKnown = false;
          else state.totalSpent += used * unitCost;
        }
        item.usageSamples ||= [];
        item.usageSamples.push({ t, seconds: dt, used });
        item.usageSamples = item.usageSamples.filter((s) => s.t > t - 300000).slice(-200);
      }
      Object.assign(item, { count, at: t, pending: null, status: "Reading" });
      changed();
      return true;
    }
    return {
      state,
      add,
      observe,
      setUnitCost(id, value) {
        const item = state.items.find((i) => i.id === id);
        if (
          !item ||
          (value !== null &&
            (!Number.isFinite(value) || value < 0 || value > 1e9))
        )
          return false;
        item.unitCost = value;
        changed();
        return true;
      },
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
        state.totalSpent = 0;
        state.spendKnown = true;
        for (const i of state.items) {
          i.used = 0;
          i.seconds = 0;
          i.usageSamples = [];
        }
        invalidate();
        changed();
      },
      rate(item, now = Date.now()) {
        if (!item || !Number.isFinite(now)) return null;
        const cutoff = now - 300000;
        let used = 0,
          seconds = 0;
        for (const sample of item.usageSamples || []) {
          if (!Number.isFinite(sample.t) || sample.t > now || sample.t <= cutoff || !Number.isFinite(sample.seconds) || sample.seconds <= 0 || sample.seconds > 25 || !Number.isFinite(sample.used) || sample.used < 0) continue;
          const observedStart = sample.t - sample.seconds * 1000,
            overlapMs = sample.t - Math.max(cutoff, observedStart);
          if (overlapMs <= 0) continue;
          const fraction = overlapMs / (sample.seconds * 1000);
          seconds += overlapMs / 1000;
          used += sample.used * fraction;
        }
        return seconds >= 30 ? (used / seconds) * 3600 : null;
      },
    };
  }

  return { create: createStore, validRegion };
});
