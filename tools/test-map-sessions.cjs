const assert = require("node:assert/strict");
const MapSessions = require("../map-sessions");
const Session = require("../session");

const state = {
  startAt: 1000,
  mapHistory: [
    { t: 1000, name: "Maple Road" },
    { t: 4000, name: "Pig Beach" },
    { t: 7000, name: "Maple Road" },
  ],
  samples: [
    { t: 1000, level: 10, exp: 0 },
    { t: 2000, level: 10, exp: 100 },
    { t: 3000, level: 10, exp: 200 },
    { t: 4000, level: 10, exp: 250 },
    { t: 5000, level: 10, exp: 300 },
    { t: 6000, level: 10, exp: 500 },
    { t: 7000, level: 10, exp: 550 },
    { t: 8000, level: 10, exp: 750 },
  ],
  mesoSamples: [
    { t: 1000, amount: 1000 },
    { t: 3000, amount: 900 },
    { t: 5000, amount: 850 },
    { t: 6000, amount: 800 },
    { t: 7000, amount: 800 },
    { t: 8000, amount: 700 },
  ],
};
const visits = MapSessions.create(state, 8000, (sample) => sample.exp);
assert.deepEqual(visits.map((visit) => visit.name), ["Maple Road", "Pig Beach", "Maple Road"]);
assert.deepEqual(visits.map((visit) => visit.expGain), [200, 250, 200]);
assert.deepEqual(visits.map((visit) => visit.mesoChange), [-100, -50, -100]);
assert.equal(visits[0].active, true);
assert.equal(visits[2].active, false);
assert.deepEqual(
  MapSessions.samplesForVisit(state.samples, visits[0], 8000).map((sample) => sample.t),
  [7000, 8000],
  "The live dashboard starts from the latest map visit while preserving earlier visits",
);
const interrupted = MapSessions.create({
  startAt: 1000,
  mapHistory: [
    { t: 1000, name: "Map A" },
    { t: 4000, name: null },
    { t: 7000, name: "Map B" },
  ],
  samples: [
    { t: 1000, level: 10, exp: 0 },
    { t: 2000, level: 10, exp: 100 },
    { t: 5000, level: 10, exp: 500 },
    { t: 8000, level: 10, exp: 800 },
  ],
}, 8000, (sample) => sample.exp);
assert.deepEqual(interrupted.map((visit) => visit.name), ["Map B", "Map A"]);
assert.deepEqual(
  interrupted.map((visit) => visit.expGain),
  [0, 100],
  "unverified-map intervals break map-specific metrics instead of bridging across them",
);

let now = 1000;
const saved = new Map();
const session = Session.create({
  now: () => now,
  storage: {
    getItem: (key) => saved.get(key) || null,
    setItem: (key, value) => saved.set(key, value),
  },
});
session.setMapName("Maple Road", 1000);
session.setMapName("Pig Beach", 3000);
session.setMapName("stale reading", 2000);
assert.deepEqual(session.state.mapHistory, [
  { t: 1000, name: "Maple Road" },
  { t: 2000, name: "stale reading" },
  { t: 3000, name: "Pig Beach" },
]);
assert.equal(session.state.mapName, "Pig Beach");
now = 5000;
session.reset();
assert.deepEqual(session.state.mapHistory, [{ t: 5000, name: "Pig Beach" }]);
console.log("Map visit summaries and timestamped map history passed.");
