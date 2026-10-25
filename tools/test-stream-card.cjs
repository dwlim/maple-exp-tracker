const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  C = require("../stream-card");
const html = fs.readFileSync("index.html", "utf8"),
  required = require("../session").required,
  totalExp = (s) => {
    let n = s.exp;
    for (let i = 1; i < s.level; i++) n += required(i);
    return n;
  };
const now = Date.now(),
  state = {
    running: true,
    updatedAt: now,
    level: 32,
    samples: [
      { level: 32, exp: 1000, t: now - 60000 },
      { level: 32, exp: 2000, t: now },
    ],
  };
let m = C.metrics(state, now, required, totalExp);
assert.equal(m.level, "32");
assert.equal(m.rate, "60,000");
assert.equal(m.status, "TRACKING");
assert.ok(m.percent > 1 && m.percent < 2);
assert.notEqual(m.eta, "Waiting for EXP");
assert.equal(
  C.metrics({ ...state, running: false }, now, required, totalExp).status,
  "PAUSED",
);
assert.equal(
  C.metrics(
    {
      ...state,
      samples: state.samples.map((s) => ({ ...s, estimated: true })),
    },
    now,
    required,
    totalExp,
  ).rate,
  "~60,000",
  "Percentage-only rates must be marked approximate on stream cards",
);
assert.equal(
  C.metrics(state, now + 21000, required, totalExp).status,
  "TRACKER OFFLINE",
);
assert.equal(C.metrics({}, now, required, totalExp).level, "—");
assert.equal(
  C.metrics({ level: 100, samples: [] }, now, required, totalExp).eta,
  "MAX LEVEL",
);
assert.equal(
  C.metrics(
    {
      ...state,
      samples: [
        { level: 31, exp: 108000, t: now - 60000 },
        { level: 32, exp: 100, t: now },
      ],
    },
    now,
    required,
    totalExp,
  ).rate,
  "34,800",
  "Level-up rate uses total EXP",
);
assert.equal(
  C.metrics(
    { ...state, samples: [{ level: 32, exp: 1000, t: now - 600000 }] },
    now,
    required,
    totalExp,
  ).rate,
  "—",
  "Old samples must not show a live rate",
);
assert.equal(
  C.metrics(
    {
      samples: [
        { level: 32, exp: -1, t: now },
        { level: 32, exp: 0, t: now + 60000 },
      ],
    },
    now,
    required,
    totalExp,
  ).level,
  "—",
);

// Boot the actual stream URL: it must only render, never request capture or write session data.
const nodes = new Map(),
  events = new Map(),
  intervals = [];
let potionSnapshot = null;
let writes = 0,
  stored = JSON.stringify(state);
const q = (id) => {
  if (!nodes.has(id))
    nodes.set(id, {
      style: {},
      setAttribute(name, value) {
        this[name] = value;
      },
      classList: { add() {}, toggle() {} },
      innerHTML: "",
    });
  return nodes.get(id);
};
const storage = {
  getItem: (k) =>
    k === "maple-track-potion-costs-v1" ? potionSnapshot : stored,
  setItem() {
    writes++;
  },
};
const win = {
  addEventListener: (name, fn) => events.set(name, fn),
  removeEventListener: (name) => events.delete(name),
  setInterval(fn, ms) {
    intervals.push({ fn, ms });
    return 1;
  },
  clearInterval(id) {
    assert.equal(id, 1);
  },
};
const context = {
  document: { querySelector: q, body: q("body") },
  window: win,
  location: { search: "?stream=1" },
  URLSearchParams,
  localStorage: storage,
  MapleStreamCard: C,
  setInterval() {
    throw Error("Dashboard loop must not run in the stream card");
  },
  navigator: {
    mediaDevices: {
      getDisplayMedia() {
        throw Error("Card must not capture");
      },
    },
  },
};
require("../app").mount({
  document: context.document,
  window: win,
  storage,
  location: context.location,
  navigator: context.navigator,
});
assert.equal(writes, 0);
assert.equal(q("#cardLevel").textContent, "32");
assert.equal(q("#cardRate").textContent, "60,000");
assert.equal(intervals[0].ms, 5000);
stored = JSON.stringify({ ...state, samples: [], level: 56, running: false });
events.get("storage")({ key: "maple-track-v1" });
assert.equal(q("#cardLevel").textContent, "56");
assert.equal(q("#cardStatus").textContent, "PAUSED");
potionSnapshot = JSON.stringify({
  updatedAt: Date.now(),
  enabled: true,
  items: [
    { group: "hp", price: 80, rate: 100, lastReadAt: Date.now() },
    { group: "mp", price: 220, rate: 200, lastReadAt: Date.now() },
  ],
});
events.get("storage")({ key: "maple-track-potion-costs-v1" });
assert.equal(q("#cardHpCost").textContent, "8,000 mesos");
assert.equal(q("#cardMpCost").textContent, "44,000 mesos");
potionSnapshot = "invalid";
events.get("storage")({ key: "maple-track-potion-costs-v1" });
assert.equal(q("#cardHpCost").textContent, "—");
stored = "invalid";
events.get("storage")({ key: null });
assert.equal(
  q("#cardLevel").textContent,
  "—",
  "Cleared or malformed storage must reset the card",
);
events.get("pagehide")();
assert.equal(events.has("storage"), false);
assert.ok(
  html.includes(fs.readFileSync("stream-card.js", "utf8")),
  "Embedded stream card must match tested source",
);
console.log(
  "Stream card: rates, level-ups, ETA, stale/offline state, local storage sync, malformed storage, read-only startup and cleanup passed.",
);

// Thirty-second normalization, level-up totals, gaps, invalid readings and percentage precision.
let g = C.graph(
  {
    samples: [
      { level: 32, exp: 100, t: now - 20000 },
      { level: 32, exp: 140, t: now - 10000 },
      { level: 32, exp: 200, t: now },
    ],
  },
  now,
  totalExp,
);
assert.deepEqual(
  g.points.map((p) => p.value),
  [120, 180],
);
assert.ok(g.path.startsWith("M"));
assert.ok(g.path.includes("L"));
assert.equal(
  C.graph(state, now, totalExp).points.length,
  0,
  "Long gaps must not invent ten-second gains",
);
assert.equal(
  C.graph(
    {
      samples: [
        { level: 32, exp: 100, t: now - 5000 },
        { level: 32, exp: 140, t: now },
      ],
    },
    now,
    totalExp,
  ).points[0].value,
  240,
);
assert.equal(
  C.graph(
    {
      samples: [
        { level: 31, exp: required(31) - 100, t: now - 10000 },
        { level: 32, exp: 50, t: now, estimated: true },
      ],
    },
    now,
    totalExp,
  ).points[0].value,
  450,
);
assert.equal(
  C.graph(
    {
      samples: [
        { level: 32, exp: 100, t: now - 10000 },
        { level: 32, exp: 50, t: now },
      ],
    },
    now,
    totalExp,
  ).points.length,
  0,
);
assert.equal(C.graph({}, now, totalExp).path, "");

assert.ok(g.max >= Math.max(...g.points.map((p) => p.value)));
assert.ok(
  Number(q("#cardAxisTop").textContent) > 0,
  "Graph Y axis renders a positive upper bound",
);

assert.equal(
  C.graph(
    {
      samples: [
        { level: 32, exp: 100, t: now - 30000 },
        { level: 32, exp: 190, t: now },
      ],
    },
    now,
    totalExp,
  ).points[0].value,
  90,
  "Thirty-second samples remain connected and show actual gain",
);
