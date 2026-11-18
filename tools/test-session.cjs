const S = require("../session"),
  DropProbe = require("../drop-feed-probe"),
  L = require("../level-ocr"),
  assert = require("node:assert/strict");
let saved,
  writes = 0,
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
    writes++;
  },
};
const session = S.create({
  storage,
  levelOcr: L,
  isValidDropNotice: (text) => DropProbe.parseNotices(text).includes(text),
  now: () => clock,
  onChange: () => changed++,
});
assert.equal(session.state.running, false);
assert.equal(session.state.source, null);
assert.equal(session.state.calibration.auto, false);
assert.equal(session.state.level, 39);
assert.equal(session.addSample(39, S.required(39) + 1), false);
assert.equal(session.addSample(39, 1100), true);
assert.equal(saved.samples.length, 2, "accepted readings persist immediately");
assert.equal(session.addMesoSample(120000, clock), true);
assert.equal(session.state.mesoStartAmount, 120000);
assert.equal(saved.mesoSamples.length, 1, "meso readings persist immediately");
assert.equal(session.addMesoSample(120000, clock), false);
session.state.mapName = "Maple Road · Pig Beach";
assert.equal(session.addDropNotice("Red Potion x1 (Use)", clock, 91), true);
assert.equal(session.state.dropNotices[0].map, "Maple Road · Pig Beach");
assert.equal(session.addDropNotice("Potion garbage x? (Use)", clock + 500), false);
assert.equal(session.addDropNotice("Red Potion x1 (Use)", clock + 500), false);
assert.equal(session.addDropNotice("Red Potion x1 (Use)", clock + 1300), true);
session.save();
assert.equal(saved.samples.length, 2);
assert.equal(saved.mesoSamples.length, 1);
assert.equal(saved.dropNotices.length, 2);
assert.equal(saved.updatedAt, clock);
assert.equal(saved.screen, null);
assert.equal(changed, 4);
assert.equal(saved.schemaVersion, 1);
const writesBeforeNoop = writes;
session.save();
assert.equal(writes, writesBeforeNoop, "repeated saves of unchanged state are deduplicated");
assert.equal(session.update({ mesoStatus: "Aligned" }), true, "session update commits changed domain state");
assert.equal(saved.mesoStatus, "Aligned", "domain updates persist immediately");
assert.equal(session.update({ mesoStatus: "Aligned" }), false, "no-op domain updates are ignored");
assert.equal(session.update({ samples: [] }), false, "generic updates cannot overwrite domain histories");
assert.equal(writes, writesBeforeNoop + 1, "a no-op update does not emit another storage write");
assert.equal(changed, 5, "only actual domain changes notify listeners");
for (let n = 0; n < 250; n++) session.addSample(39, n, clock + n);
assert.equal(session.state.samples.length, 240);
assert.equal(session.samples()[0].exp, 10);
clock += 60000;
session.reset();
assert.equal(session.state.level, null);
assert.equal(session.state.samples.length, 0);
assert.equal(session.state.mesoSamples.length, 0);
assert.equal(session.state.mesoStartAmount, null);
assert.equal(session.state.dropNotices.length, 0);
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
const migratedDropState = S.create({
  storage: {
    getItem: () => JSON.stringify({
      dropNotices: [
        { text: "You have obtained Red Potion", t: clock - 1000 },
        { text: "Red Potion x1 (Use)", t: clock - 500 },
      ],
    }),
  },
  isValidDropNotice: (text) => DropProbe.parseNotices(text).includes(text),
});
assert.deepEqual(
  migratedDropState.state.dropNotices.map((entry) => entry.text),
  ["Red Potion x1 (Use)"],
  "Discard legacy or noisy notices that do not match a confirmed toast format",
);
const canonicalOnly = new Set(["Maple Road · Pig Beach"]),
  sanitized = S.create({
    storage: {
      getItem: () => JSON.stringify({
        mapName: "Victoria Road · Tree lnmgeon, Forest Up North IX",
        mapUpdatedAt: clock - 5000,
        mapHistory: [
          { t: clock - 10000, name: "Maple Road · Pig Beach" },
          { t: clock - 5000, name: "Victoria Road · Tree lnmgeon, Forest Up North IX" },
        ],
      }),
      setItem() {},
    },
    isCanonicalMapName: (name) => canonicalOnly.has(name),
    now: () => clock,
  });
assert.equal(sanitized.state.mapName, "", "discard a persisted map label outside the catalog");
assert.deepEqual(
  sanitized.state.mapHistory,
  [
    { t: clock - 10000, name: "Maple Road · Pig Beach" },
    { t: clock - 5000, name: null },
  ],
  "keep a boundary where an invalid persisted map was observed",
);
assert.equal(sanitized.setMapName("Victoria Road · Tree lnmgeon, Forest Up North IX"), false);
assert.equal(sanitized.setMapName("Maple Road · Pig Beach"), true);
assert.equal(S.required(70), 2062925);
const malformed = S.create({
  storage: {
    getItem: () => JSON.stringify({
      samples: [{ t: "bad", level: 20, exp: 10 }, null, { t: clock, level: 20, exp: 10 }],
      mesoSamples: {},
      mapHistory: null,
      calibration: "invalid",
      mesoRegion: { x: 0.9, y: 0.9, w: 0.2, h: 0.2 },
      level: 999,
      startAt: "bad",
    }),
  },
  levelOcr: L,
  now: () => clock,
});
assert.equal(malformed.state.samples.length, 1, "invalid saved samples are discarded during hydration");
assert.deepEqual(malformed.state.mesoSamples, [], "non-array meso history is normalized");
assert.deepEqual(malformed.state.mapHistory, [], "non-array map history is normalized");
assert.equal(malformed.state.calibration.auto, true, "malformed calibration falls back to auto mode");
assert.equal(malformed.state.mesoRegion, null, "out-of-bounds saved regions are discarded");
assert.equal(malformed.state.level, null, "out-of-range saved level is discarded");
assert.equal(malformed.state.startAt, null, "invalid saved timestamps are discarded");
const blockedStorage = S.create({
  storage: { getItem: () => null, setItem() { throw new Error("quota exceeded"); } },
  levelOcr: L,
});
assert.equal(blockedStorage.addSample(20, 100), true, "storage failures do not block in-memory tracking");
assert.equal(blockedStorage.save(), false, "save reports unavailable storage without throwing");
assert.equal(S.levelStartExp(32) + 100, S.totalExp({ level: 32, exp: 100 }));
assert.equal(
  S.parseHudReading("LV. 31", "EXP. 2.304 [2.12%]").expToken,
  "2,304",
);
console.log(
  "Session module: storage compatibility, startup state, validation, bounded history, reset, calibration and EXP math passed.",
);
