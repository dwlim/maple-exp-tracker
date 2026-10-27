(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./potion-costs")
      : root.MaplePotionCosts,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MapleStreamCard = api;
})(typeof window === "undefined" ? globalThis : window, function (Costs) {
  function metrics(state, now, required, totalExp) {
    const samples = (Array.isArray(state.samples) ? state.samples : [])
        .filter(
          (s) =>
            Number.isInteger(s.level) &&
            s.level >= 1 &&
            s.level <= 100 &&
            Number.isFinite(s.exp) &&
            s.exp >= 0 &&
            Number.isFinite(s.t) &&
            s.t <= now,
        )
        .sort((a, b) => a.t - b.t),
      latest = samples.at(-1),
      base = samples.find((s) => s.t >= now - 300000);
    const level = latest?.level ?? state.level,
      need = required(level),
      exp = latest?.exp || 0;
    const rate =
      base && latest && latest.t > base.t
        ? Math.max(
            0,
            (totalExp(latest) - totalExp(base)) /
              ((latest.t - base.t) / 3600000),
          )
        : 0;
    const remaining =
      need > 0 && rate > 0
        ? Math.max(0, ((need - exp) / rate) * 3600000)
        : null;
    const eta =
      level === 100
        ? "MAX LEVEL"
        : remaining === null
          ? "Waiting for EXP"
          : remaining < 60000
            ? "Under 1 min"
            : remaining < 3600000
              ? Math.round(remaining / 60000) + " min"
              : Math.floor(remaining / 3600000) +
                "h " +
                Math.floor((remaining % 3600000) / 60000) +
                "m";
    return {
      level:
        Number.isInteger(level) && level >= 1 && level <= 100
          ? String(level)
          : "—",
      rate: rate
        ? (base?.estimated || latest?.estimated ? "~" : "") +
          Math.round(rate).toLocaleString("en-US")
        : "—",
      percent: need ? Math.max(0, Math.min(100, (exp / need) * 100)) : 0,
      eta,
      status:
        !state.updatedAt || now - state.updatedAt > 20000
          ? "TRACKER OFFLINE"
          : state.running
            ? "TRACKING"
            : "PAUSED",
    };
  }
  function mesoMetrics(state, now) {
    const samples = (Array.isArray(state.mesoSamples) ? state.mesoSamples : [])
        .filter((s) => Number.isSafeInteger(s.amount) && s.amount >= 0 && Number.isFinite(s.t) && s.t <= now)
        .sort((a, b) => a.t - b.t),
      latest = samples.at(-1),
      base = samples.find((s) => s.t >= now - 300000) || samples[0],
      elapsed = latest && base ? latest.t - base.t : 0,
      rate = elapsed >= 60000 ? ((latest.amount - base.amount) * 3600000) / elapsed : null;
    return {
      amount: latest && now - latest.t <= 120000 ? latest.amount.toLocaleString("en-US") : "—",
      rate: rate === null || !latest || now - latest.t > 120000
        ? "—"
        : (rate > 0 ? "+" : rate < 0 ? "−" : "") + Math.round(Math.abs(rate)).toLocaleString("en-US"),
      rateValue: rate === null || !latest || now - latest.t > 120000 ? null : rate,
    };
  }
  function netMesoRate(rateValue, potionState, potionMetrics, now) {
    if (
      !Number.isFinite(rateValue) ||
      !potionState ||
      potionState.enabled !== true ||
      !Array.isArray(potionState.items) ||
      !potionState.items.length ||
      !Number.isFinite(potionState.updatedAt) ||
      potionState.updatedAt > now ||
      now - potionState.updatedAt > 25000
    ) return null;
    const groups = new Set(potionState.items.map((item) => item?.group));
    let spend = 0;
    for (const group of groups) {
      if (!["hp", "mp", "both"].includes(group) || !Number.isFinite(potionMetrics[group])) return null;
      spend += potionMetrics[group];
    }
    return Number.isFinite(spend) ? rateValue - spend : null;
  }
  function formatMesoRate(rate) {
    return (rate > 0 ? "+" : rate < 0 ? "−" : "") + Math.round(Math.abs(rate)).toLocaleString("en-US");
  }
  // Normalize adjacent readings to thirty seconds; gaps stay empty rather than implying steady gains.
  function graph(state, now, totalExp) {
    const samples = (state.samples || [])
        .filter(
          (s) =>
            Number.isFinite(s.t) &&
            s.t <= now &&
            Number.isInteger(s.level) &&
            s.level >= 1 &&
            s.level <= 100 &&
            Number.isFinite(s.exp) &&
            s.exp >= 0,
        )
        .sort((a, b) => a.t - b.t),
      points = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i],
        dt = b.t - a.t,
        gain = totalExp(b) - totalExp(a);
      if (b.t < now - 300000 || dt <= 0 || dt > 45000 || gain < 0) continue;
      points.push({
        t: b.t,
        value: (gain * 30000) / dt,
        estimated: !!(a.estimated || b.estimated),
      });
    }
    const peak = Math.max(1, ...points.map((p) => p.value)),
      step = 10 ** Math.floor(Math.log10(peak)),
      max = Math.ceil(peak / step) * step;
    let previous = null;
    const path = points
      .map((p) => {
        const x = Math.max(0, Math.min(300, (p.t - (now - 300000)) / 1000)),
          y = 68 - (p.value / max) * 62,
          move = !previous || p.t - previous.t > 45000;
        previous = p;
        return (move ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
    return { path, max, points, estimated: points.some((p) => p.estimated) };
  }
  function mount({
    document,
    window,
    storage,
    key,
    required,
    totalExp,
    now = Date.now,
  }) {
    document.title = "Maple Track · Stream card";
    document.body.classList.add("stream-card");
    document.querySelector(".app").innerHTML =
      '<section class="stream-panel" aria-label="Maple Track live stream card"><header><span>MAPLE TRACK</span><span id="cardStatus">CONNECTING</span></header><div class="stream-values"><div><span>LEVEL</span><strong id="cardLevel">—</strong></div><div><span>EXP / HOUR</span><strong id="cardRate">—</strong></div></div><div class="stream-progress"><i id="cardFill"></i></div><footer><span id="cardPercent">0.00%</span><span id="cardEta">Waiting for EXP</span></footer><div class="stream-costs"><div><span>HP POTIONS / HOUR</span><strong id="cardHpCost">—</strong></div><div><span>MP POTIONS / HOUR</span><strong id="cardMpCost">—</strong></div><div id="cardBothRow" hidden><span>HP + MP / HOUR</span><strong id="cardBothCost">—</strong></div><small>Estimated mesos · observed potion usage</small></div><div class="stream-meso-values"><div><span>MESO BALANCE</span><strong id="cardMesoBalance">—</strong></div><div><span>MESOS / HOUR</span><strong id="cardMesoRate">—</strong></div></div><div class="stream-net"><span>NET MESOS / HOUR</span><strong id="cardNetMesoRate">—</strong><small id="cardNetMesoHint">Needs fresh meso and priced potion readings</small></div><div class="stream-chart"><div class="stream-chart-label"><span>EXP / 30 SEC · LAST 5 MIN</span><span id="cardGraphPeak">—</span></div><svg viewBox="0 0 342 76" role="img" aria-label="EXP gained per thirty seconds over the last five minutes"><g fill="#93949f" font-size="8" font-family="monospace" text-anchor="end"><text id="cardAxisTop" x="35" y="9">1</text><text id="cardAxisMid" x="35" y="40">0.5</text><text x="35" y="71">0</text></g><g transform="translate(42 0)"><path d="M0,6H300M0,37H300M0,68H300M0,6V68" stroke="#34353e" stroke-width="0.7" fill="none"/><path id="cardGraph" fill="none" stroke="#c7f36b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></g></svg><span id="cardGraphHint">Waiting for readings</span></div></section>';
    const q = (id) => document.querySelector(id);
    function render() {
      let state = {};
      try {
        state = JSON.parse(storage.getItem(key) || "{}") || {};
      } catch {}
      let costs = {};
      try {
        costs = JSON.parse(storage.getItem(Costs.KEY) || "{}");
      } catch {}
      const cm = Costs.metrics(costs, now()),
        costText = (n) =>
          n === null ? "—" : Math.round(n).toLocaleString("en-US") + " mesos";
      q("#cardHpCost").textContent = costText(cm.hp);
      q("#cardMpCost").textContent = costText(cm.mp);
      q("#cardBothCost").textContent = costText(cm.both);
      q("#cardBothRow").hidden = !cm.hasBoth;
      const m = metrics(state, now(), required, totalExp);
      const mm = mesoMetrics(state, now());
      const net = netMesoRate(mm.rateValue, costs, cm, now());
      q("#cardMesoBalance").textContent = mm.amount;
      q("#cardMesoRate").textContent = mm.rate;
      q("#cardNetMesoRate").textContent = net === null ? "—" : formatMesoRate(net);
      q("#cardNetMesoHint").textContent = net === null
        ? "Needs fresh meso and priced potion readings"
        : "Meso gain after observed potion costs";
      q("#cardLevel").textContent = m.level;
      q("#cardRate").textContent = m.rate;
      q("#cardPercent").textContent = m.percent.toFixed(2) + "%";
      q("#cardFill").style.width = m.percent + "%";
      q("#cardEta").textContent =
        m.eta === "MAX LEVEL" ? m.eta : "Level up · " + m.eta;
      q("#cardStatus").textContent = m.status;
      const g = graph(state, now(), totalExp);
      q("#cardGraph").setAttribute("d", g.path);
      const axis = (n) =>
        Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(n);
      q("#cardAxisTop").textContent = axis(g.max);
      q("#cardAxisMid").textContent = axis(g.max / 2);
      q("#cardGraphPeak").textContent = g.points.length
        ? (g.estimated ? "~" : "") +
          Math.ceil(g.max).toLocaleString("en-US") +
          " peak"
        : "—";
      q("#cardGraphHint").textContent = g.points.length
        ? g.estimated
          ? "Estimated from percentage"
          : ""
        : "Waiting for two readings";
    }
    const onStorage = (event) => {
      if (event.key === key || event.key === Costs.KEY || event.key === null)
        render();
    };
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(render, 5000);
    window.addEventListener(
      "pagehide",
      () => {
        window.clearInterval(timer);
        window.removeEventListener("storage", onStorage);
      },
      { once: true },
    );
    render();
  }
  return { metrics, mesoMetrics, netMesoRate, graph, mount };
});
