const assert = require("node:assert/strict"),
  Costs = require("../potion-costs"),
  Items = require("../quickslot-session");
const now = Date.now(),
  memory = new Map(),
  storage = {
    getItem: (k) => memory.get(k) || null,
    setItem: (k, v) => memory.set(k, v),
  },
  store = Items.create({ storage }),
  region = { x: 0.1, y: 0.8, w: 0.1, h: 0.1 };
const hp = store.add("Meat", region, 100, 100, null, { potionType: "meat" }),
  mp = store.add("Blue Potion", region, 100, 100, null, { potionType: "blue" });
store.enable(true);
for (let n = 0; n <= 3; n++) {
  store.observe(
    hp.id,
    { count: 100 - n, confidence: 99 },
    now - 30000 + n * 10000,
  );
  store.observe(
    mp.id,
    { count: 100 - 2 * n, confidence: 99 },
    now - 30000 + n * 10000,
  );
}
const get = () => Costs.metrics(Costs.snapshot(store, true, now), now);
assert.deepEqual(get(), { hp: 28800, mp: 158400, both: null, hasBoth: false });
assert.equal(Costs.price(hp), 80);
assert.equal(Costs.price(mp), 220);
assert.equal(store.setUnitCost(hp.id, 50), true);
assert.equal(get().hp, 18000);
assert.equal(store.setUnitCost(hp.id, 0), true);
assert.equal(get().hp, 0, "Free items must not revert to NPC price");
assert.equal(store.setUnitCost(hp.id, null), true);
assert.equal(get().hp, 28800);
for (const invalid of [-1, Infinity, NaN, 1e10, "50"])
  assert.equal(store.setUnitCost(hp.id, invalid), false);
store.setUnitCost(hp.id, 75);
const loaded = Items.create({ storage });
assert.equal(loaded.state.items[0].unitCost, 75, "Override survives reload");
assert.equal(
  Costs.metrics(Costs.snapshot(loaded, true, now), now).hp,
  null,
  "Persisted usage is not a fresh live rate",
);
const unknown = store.add("Other HP", region, 100, 100, null, {
  potionType: "hp",
});
unknown.at = now;
unknown.used = 1;
unknown.seconds = 30;
assert.equal(
  get().hp,
  null,
  "Missing price must not silently understate a category total",
);
store.setUnitCost(unknown.id, 0);
assert.equal(get().hp, 27000);
const both = store.add("Elixir", region, 100, 100, null, {
  potionType: "both",
});
both.at = now;
both.used = 1;
both.seconds = 30;
store.setUnitCost(both.id, 3000);
assert.equal(get().both, 360000);
assert.equal(get().hp, 27000, "Combined cost is not counted twice");
assert.equal(get().mp, 158400);
const snapshot = Costs.snapshot(store, true, now);
assert.equal(Costs.metrics(snapshot, now + 25001).mp, null);
assert.equal(Costs.metrics({ ...snapshot, updatedAt: now + 1 }, now).mp, null);
mp.at = now - 26000;
assert.equal(get().mp, null);
assert.equal(Costs.metrics(Costs.snapshot(store, false, now), now).hp, null);
store.enable(false);
assert.equal(get().hp, null);
for (const bad of [
  null,
  [],
  {},
  { enabled: true, updatedAt: now, items: "bad" },
])
  assert.equal(Costs.metrics(bad, now).hp, null);
assert.equal(
  Costs.price({ potionType: "mana" }),
  null,
  "Unverified buy prices must stay unknown",
);
console.log(
  "Potion costs: verified buy-price defaults, observed rates, custom/free prices, persistence, partial totals, combined potions, stale/disabled snapshots and malformed data passed.",
);
