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
unknown.usageSamples = [
  { t: now - 15000, seconds: 15, used: 0 },
  { t: now, seconds: 15, used: 1 },
];
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
both.usageSamples = [
  { t: now - 15000, seconds: 15, used: 0 },
  { t: now, seconds: 15, used: 1 },
];
store.setUnitCost(both.id, 3000);
assert.equal(get().both, 360000);
assert.equal(get().hp, 27000, "Combined cost is not counted twice");
assert.equal(get().mp, 158400);
const snapshot = Costs.snapshot(store, true, now);
assert.equal(Costs.metrics(snapshot, now + 25001).mp, null);
assert.equal(Costs.metrics({ ...snapshot, updatedAt: now + 1 }, now).mp, null);
const stockMemory = new Map(),
  stockStorage = {
    getItem: (key) => stockMemory.get(key) || null,
    setItem: (key, value) => stockMemory.set(key, value),
  },
  stockStore = Items.create({ storage: stockStorage, key: "active-profile" }),
  stock = stockStore.add("Red Potion", region, 100, 100, null, {
    potionType: "red",
  });
stockStore.setUnitCost(stock.id, 50);
stockStore.enable(true);
for (const [t, count] of [
  [now - 4000, 100],
  [now - 3000, 200],
  [now - 2000, 200],
  [now - 1000, 150],
  [now, 150],
])
  stockStore.observe(stock.id, { count, confidence: 99 }, t);
const stockSnapshot = Costs.snapshot(stockStore, true, now, "active-profile"),
  stockItems = JSON.parse(stockStorage.getItem("active-profile")).items.map((item) => ({
    ...item,
    group: Costs.catalog[item.potionType].group,
    price: Costs.price(item),
  })),
  inventoryDelta = Items.inventoryValueSince(
    stockItems,
    now - 5000,
    now,
  );
assert.equal(stockSnapshot.inventoryKey, "active-profile");
assert.equal(
  Object.hasOwn(stockSnapshot.items[0], "inventorySamples"),
  false,
  "The lightweight shared snapshot points to the active store instead of duplicating its history",
);
assert.deepEqual(inventoryDelta, {
  value: 2500,
  known: true,
  configured: true,
}, "Restocking is reflected as ending stock value minus starting stock value");
assert.equal(
    -5000 + inventoryDelta.value,
  -2500,
  "Map-visit net change adds potion inventory value to wallet change",
);
assert.equal(
  -5000 + inventoryDelta.value + 2500,
  0,
  "Adding consumed stock cost reconstructs gross mesos without double-counting a restock",
);
const stockTotals = Items.inventoryTotalsSince(stockItems, now - 5000, now);
const restockTotals = Items.inventoryTotalsSince(
  stockItems.map((item) => ({
    ...item,
    inventorySamples: [{ t: now - 4000, count: 100 }, { t: now, count: 200 }],
  })),
  now - 5000,
  now,
);
assert.deepEqual(stockTotals, {
  startValue: 5000,
  endValue: 7500,
  known: true,
  startKnown: true,
  endKnown: true,
  configured: true,
}, "Combined totals expose the session-start and current potion values");
const currentOnlyTotals = Items.inventoryTotalsSince(
  [{ group: "hp", price: 50, inventorySamples: [{ t: now, count: 12 }] }],
  now - 30000,
  now,
);
assert.deepEqual(currentOnlyTotals, {
  startValue: null,
  endValue: 600,
  known: false,
  startKnown: false,
  endKnown: true,
  configured: true,
}, "A missing session-start potion baseline does not hide the known current inventory total");
assert.equal(
  (10000 - 5000 + restockTotals.endValue) - (10000 + restockTotals.startValue),
  0,
  "Buying potion stock reduces wallet mesos but does not change the combined total",
);
assert.equal(
  Items.inventoryValueSince(
    [{ group: "hp", price: 50, inventorySamples: [] }],
    now - 2000,
    now,
  ).known,
  false,
  "Missing inventory boundary reads cannot be treated as a zero adjustment",
);
assert.equal(
  Items.inventoryValueSince(
    [{ group: "hp", price: null, inventorySamples: [{ t: now - 2000, count: 100 }, { t: now, count: 50 }] }],
    now - 2000,
    now,
  ).known,
  false,
  "Unknown potion prices cannot create a fabricated inventory value",
);
assert.equal(
  Items.inventoryTotalsSince(
    [{ group: "hp", price: null, inventorySamples: [{ t: now - 2000, count: 100 }, { t: now, count: 100 }] }],
    now - 2000,
    now,
  ).known,
  false,
  "Current inventory totals require a known unit value even if stock is unchanged",
);
const sessionInventory = Items.inventoryValueSince(
  [
    {
      group: "hp",
      price: 50,
      inventorySamples: [
        { t: now - 3000, count: 100 },
        { t: now - 2000, count: 150 },
        { t: now, count: 120 },
      ],
    },
  ],
  now - 4000,
  now,
);
assert.deepEqual(sessionInventory, {
  value: 1000,
  known: true,
  configured: true,
}, "Session profit uses the first observed stock after the session starts");
assert.equal(
  Items.inventoryValueSince(
    [{ group: "hp", price: 50, inventorySamples: [{ t: now, count: 120 }] }],
    now - 30000,
    now,
  ).known,
  false,
  "A late first potion reading cannot be mistaken for the session-start balance",
);
let resetClock = 100000;
const resetMemory = new Map(),
  resetStorage = {
    getItem: (key) => resetMemory.get(key) || null,
    setItem: (key, value) => resetMemory.set(key, value),
  },
  resetStore = Items.create({ storage: resetStorage, now: () => resetClock }),
  resetPotion = resetStore.add("Red Potion", region, 100, 100, null, {
    potionType: "red",
  });
resetStore.enable(true);
resetStore.observe(resetPotion.id, { count: 100, confidence: 99 }, resetClock);
resetClock += 10000;
resetStore.invalidate();
resetStore.reset();
assert.deepEqual(
  resetStore.state.items[0].inventorySamples,
  [{ t: resetClock, count: 100 }],
  "New session seeds potion baseline from the latest fresh stock read",
);
resetStore.observe(
  resetPotion.id,
  { count: 80, confidence: 99 },
  resetClock + 10000,
);
assert.deepEqual(
  Items.inventoryValueSince(
    resetStore.state.items.map((item) => ({
      ...item,
      group: Costs.catalog[item.potionType].group,
      price: Costs.price(item),
    })),
    resetClock,
    resetClock + 10000,
  ),
  { value: -1000, known: true, configured: true },
  "Net profit can value potions consumed after starting a new session",
);
resetClock += 35001;
resetStore.reset();
assert.deepEqual(
  resetStore.state.items[0].inventorySamples,
  [],
  "A stale potion count is not reused as a new session baseline",
);
let refillClock = 1000000;
const refillStore = Items.create({
    storage: { getItem: () => null, setItem: () => {} },
    now: () => refillClock,
  }),
  refillPotion = refillStore.add("Red Potion", region, 100, 100, null, {
    potionType: "red",
  });
refillStore.enable(true);
for (let i = 0; i <= 3; i++)
  refillStore.observe(
    refillPotion.id,
    { count: 100, confidence: 99 },
    refillClock + i * 10000,
  );
const validUsageBeforeRefill = refillPotion.usageSamples.slice();
refillStore.observe(
  refillPotion.id,
  { count: 184, confidence: 99 },
  refillClock + 40000,
);
assert.deepEqual(
  refillPotion.usageSamples,
  validUsageBeforeRefill,
  "A refill omits its ambiguous interval without clearing earlier valid usage samples",
);
assert.equal(
  Items.costRatesForInterval(
    [{ ...refillPotion, price: Costs.price(refillPotion) }],
    refillClock,
    refillClock + 40000,
    refillClock + 40000,
  ).hp,
  0,
  "A recently refilled slot with prior valid reads does not blank the HP cost total",
);
assert.deepEqual(
  Items.costRatesForInterval(
    [
      {
        potionType: "red",
        unitCost: 50,
        usageSamples: [
          { t: now - 20000, seconds: 20, used: 1 },
          { t: now, seconds: 20, used: 2 },
        ],
      },
    ],
    now - 60000,
    now,
    now,
  ),
  { hp: 13500, mp: null, both: null },
  "Hourly potion cost uses only observations inside the selected map visit and trailing-five-minute window",
);
assert.equal(
  Items.costRatesForInterval(
    [
      {
        potionType: "red",
        unitCost: 50,
        usageSamples: [{ t: now - 40000, seconds: 20, used: 1 }],
      },
    ],
    now - 10000,
    now,
    now,
  ).hp,
  null,
  "Potion use recorded before the current map visit is excluded",
);
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
