const S = require("../session"),
  L = require("../level-ocr"),
  assert = require("node:assert/strict");
let saved,
  changed = 0,
  clock = 1700000000000;
const storage = {
  getItem: () =>
    JSON.stringify({
      level: 39,
      samples: [{ level: 39, exp: 1000, t: clock - 10000 }],
      calibration: { auto: false, level: { x: 0.1 }, exp: { x: 0.2 } },
      running: true,
      source: "stale",
    }),
  setItem(k, v) {
    assert.equal(k, "maple-track-v1");
    saved = JSON.parse(v);
  },
};
const session = S.create({
  storage,
  levelOcr: L,
  now: () => clock,
  onChange: () => changed++,
});
assert.equal(session.state.running, false);
assert.equal(session.state.source, null);
assert.equal(session.state.calibration.auto, false);
assert.equal(session.state.level, 39);
assert.equal(session.addSample(39, S.required(39) + 1), false);
assert.equal(session.addSample(39, 1100), true);
assert.equal(session.addMesoSample(120000, clock), true);
assert.equal(session.state.mesoStartAmount, 120000);
assert.equal(session.addMesoSample(120000, clock), false);
session.save();
assert.equal(saved.samples.length, 2);
assert.equal(saved.mesoSamples.length, 1);
assert.equal(saved.updatedAt, clock);
assert.equal(saved.screen, null);
assert.equal(changed, 2);
for (let n = 0; n < 250; n++) session.addSample(39, n, clock + n);
assert.equal(session.state.samples.length, 240);
assert.equal(session.samples()[0].exp, 10);
clock += 60000;
session.reset();
assert.equal(session.state.level, null);
assert.equal(session.state.samples.length, 0);
assert.equal(session.state.mesoSamples.length, 0);
assert.equal(session.state.mesoStartAmount, null);
assert.equal(session.state.startAt, clock);
assert.equal(
  session.state.calibration.auto,
  false,
  "New sessions preserve calibration",
);
assert.equal(
  S.create({ storage: { getItem: () => "{broken" }, levelOcr: L }).state.samples
    .length,
  0,
);
assert.equal(S.required(70), 2062925);
assert.equal(S.levelStartExp(32) + 100, S.totalExp({ level: 32, exp: 100 }));
assert.equal(
  S.parseHudReading("LV. 31", "EXP. 2.304 [2.12%]").expToken,
  "2,304",
);
console.log(
  "Session module: storage compatibility, startup state, validation, bounded history, reset, calibration and EXP math passed.",
);
