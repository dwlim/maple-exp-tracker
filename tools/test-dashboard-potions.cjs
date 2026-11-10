const assert = require("node:assert/strict");
const Dashboard = require("../dashboard");
const QuickslotSession = require("../quickslot-session");

const values = new Map([
  [
    QuickslotSession.STORE_KEYS[0],
    JSON.stringify({
      items: [
        { potionType: "red", used: 4, restocked: 2 },
        { potionType: "orange", used: 2, restocked: 1 },
        { potionType: "blue", used: 5, restocked: 0 },
        { potionType: "both", used: 1, restocked: 3 },
        { potionType: "unknown", used: 100, restocked: 100 },
      ],
    }),
  ],
  [
    QuickslotSession.STORE_KEYS[1],
    JSON.stringify({
      items: [
        { potionType: "lemon", used: 3, restocked: 2 },
        { potionType: "meat", used: 1, restocked: 0 },
        { potionType: "hp", used: -10, restocked: -10 },
      ],
    }),
  ],
]);
const storage = { getItem: (key) => values.get(key) || null };

assert.deepEqual(Dashboard.sessionPotionUsage(storage), {
  hp: 7,
  mp: 8,
  both: 1,
  restocked: 8,
  configured: true,
  observed: false,
});
assert.deepEqual(Dashboard.sessionPotionUsage(null), {
  hp: 0,
  mp: 0,
  both: 0,
  restocked: 0,
  configured: false,
  observed: false,
});
values.set(QuickslotSession.STORE_KEYS[0], "not valid json");
assert.deepEqual(Dashboard.sessionPotionUsage(storage), {
  hp: 1,
  mp: 3,
  both: 0,
  restocked: 2,
  configured: true,
  observed: false,
});
values.set(
  QuickslotSession.STORE_KEYS[1],
  JSON.stringify({ items: [{ potionType: "red", count: 20, used: 2, restocked: 0 }] }),
);
assert.deepEqual(Dashboard.sessionPotionUsage(storage), {
  hp: 2,
  mp: 0,
  both: 0,
  restocked: 0,
  configured: true,
  observed: true,
});
console.log("Dashboard potion totals: profile aggregation, refill split, unknown items and corrupt storage passed.");
