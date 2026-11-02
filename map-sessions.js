(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleMapSessions = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  function create(state, now, totalExp) {
    const history = (Array.isArray(state.mapHistory) ? state.mapHistory : [])
        .filter((entry) => typeof entry?.name === "string" && entry.name && Number.isFinite(entry.t) && entry.t <= now)
        .sort((a, b) => a.t - b.t),
      expSamples = (Array.isArray(state.samples) ? state.samples : [])
        .filter((sample) => Number.isFinite(sample?.t) && sample.t <= now && Number.isInteger(sample.level) && sample.level >= 1 && sample.level <= 100 && Number.isFinite(sample.exp) && sample.exp >= 0)
        .sort((a, b) => a.t - b.t),
      mesoSamples = (Array.isArray(state.mesoSamples) ? state.mesoSamples : [])
        .filter((sample) => Number.isFinite(sample?.t) && sample.t <= now && Number.isSafeInteger(sample.amount) && sample.amount >= 0)
        .sort((a, b) => a.t - b.t),
      sessionStart = Number.isFinite(state.startAt)
        ? state.startAt
        : Math.min(expSamples[0]?.t ?? now, mesoSamples[0]?.t ?? now, history[0]?.t ?? now),
      events = history.filter((entry) => entry.t >= sessionStart),
      visits = events.map((entry, index) => ({
        id: index,
        name: entry.name,
        start: entry.t,
        end: events[index + 1]?.t ?? now,
        active: index === events.length - 1,
        expGain: 0,
        expElapsed: 0,
        expEstimated: false,
        mesoChange: 0,
        mesoElapsed: 0,
        expSamples: 0,
        mesoSamples: 0,
      }));

    function visitAt(t) {
      let low = 0, high = events.length - 1, found = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (events[mid].t <= t) {
          found = mid;
          low = mid + 1;
        } else high = mid - 1;
      }
      return found >= 0 ? visits[found] : null;
    }

    for (let i = 1; i < expSamples.length; i++) {
      const a = expSamples[i - 1], b = expSamples[i], visit = visitAt(b.t),
        elapsed = b.t - a.t, gain = totalExp(b) - totalExp(a);
      if (!visit || visitAt(a.t)?.id !== visit.id || elapsed <= 0 || elapsed > 45000 || gain < 0) continue;
      visit.expGain += gain;
      visit.expElapsed += elapsed;
      visit.expEstimated ||= !!(a.estimated || b.estimated);
      visit.expSamples++;
    }
    for (let i = 1; i < mesoSamples.length; i++) {
      const a = mesoSamples[i - 1], b = mesoSamples[i], visit = visitAt(b.t),
        elapsed = b.t - a.t;
      if (!visit || visitAt(a.t)?.id !== visit.id || elapsed <= 0 || elapsed > 120000) continue;
      visit.mesoChange += b.amount - a.amount;
      visit.mesoElapsed += elapsed;
      visit.mesoSamples++;
    }
    return visits
      .filter((visit) => visit.expSamples || visit.mesoSamples || visit.active)
      .reverse();
  }

  return { create };
});
