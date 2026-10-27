const assert = require("node:assert/strict"),
  z = require("node:zlib"),
  fs = require("node:fs"),
  Q = require("../quickslot-ocr"),
  Items = require("../quickslots");
const fixtures = require("./quickslot-font-fixtures.json");
for (const f of fixtures) {
  const result = Q.recognize({
    ...f,
    data: z.inflateSync(Buffer.from(f.rgba, "base64")),
  });
  assert.equal(result?.count, Number(f.text), f.name);
}
for (const f of require("./quickslot-tail-fixtures.json")) {
  const image = { ...f, data: z.inflateSync(Buffer.from(f.rgba, "base64")) };
  assert.equal(
    Q.recognizeSlot(image)?.count ?? null,
    f.expectedCount,
    f.name + " must not accept a prefix",
  );
}
assert.deepEqual(
  new Set(require("../quickslot-font").map((v) => v.digit)),
  new Set("0123456789"),
);
for (const value of [0, 100, 255])
  for (const height of [12, 14, 16])
    assert.equal(
      Q.recognize({
        width: 30,
        height,
        data: new Uint8Array(30 * height * 4).fill(value),
      }),
      null,
      "A blank slot cannot become a zero count",
    );
assert.equal(
  Q.recognize({ width: 300, height: 100, data: new Uint8Array(120000) }),
  null,
);
let heldExact = 0;
for (const f of require("./quickslot-holdout-fixtures.json")) {
  const result = Q.recognize({
    ...f,
    data: z.inflateSync(Buffer.from(f.rgba, "base64")),
  });
  if (result) {
    assert.equal(
      result.count,
      Number(f.text),
      f.name + " must never accept an incorrect count",
    );
    heldExact++;
  }
}
assert.ok(
  heldExact > 0,
  "Independent quantity crops must include an exact recognition",
);
const mem = new Map(),
  storage = {
    getItem: (k) => mem.get(k) || null,
    setItem: (k, v) => mem.set(k, v),
  },
  s = Items.createStore({ storage }),
  region = { x: 0.1, y: 0.9, w: 0.02, h: 0.02 };
assert.equal(s.add("bad", { ...region, x: -0.1 }, 1000, 1000), null);
const item = s.add("HP potions", region, 1000, 1000),
  id = item.id,
  read = (n, t, confidence = 99) =>
    s.observe(id, { count: n, confidence }, t * 1000);
assert.ok(read(1000, 0));
assert.ok(read(998, 10));
assert.equal(s.rate(item, 20000), null);
read(996, 20);
read(995, 30);
assert.equal(item.used, 5);
assert.equal(s.rate(item, 30000), 600);
assert.equal(s.rate(item, 330001), null, "Potion rates use only observations in the trailing five-minute window");
assert.equal(
  read(1050, 40),
  false,
  "A large stock change needs fresh confirmation",
);
assert.equal(read(1050, 40), false, "A duplicate frame cannot confirm");
assert.ok(read(1049, 50));
assert.equal(item.used, 5, "Refills never count as negative usage");
assert.equal(item.count, 1049);
s.observe(id, null, 60000);
assert.equal(item.count, 1049);
assert.equal(item.used, 5);
read(1047, 70);
assert.equal(item.used, 7);
s.invalidate();
read(1000, 1000);
assert.equal(item.used, 7, "Do not count changes while paused or disconnected");
const seconds = item.seconds;
assert.equal(read(100, 1010), false);
read(1000, 1020);
assert.equal(item.used, 7, "An OCR spike that recovers must not become usage");
assert.equal(item.seconds, seconds + 20);
read(900, 1030);
assert.equal(
  read(899, 1025),
  false,
  "Out-of-order frames do not confirm a jump",
);
read(899, 1040);
assert.equal(item.used, 108);
assert.equal(
  s.observe(id, { count: 0 }, 1045000),
  false,
  "Missing confidence rejects",
);
assert.equal(read(0, 1050, 20), false);
assert.equal(item.count, 899);
read(0, 1060);
read(0, 1065);
assert.equal(item.count, 0);
assert.equal(item.used, 1007);
const loaded = Items.createStore({ storage });
assert.equal(loaded.state.items[0].used, 1007);
assert.equal(loaded.state.items[0].at, null);
loaded.observe(
  loaded.state.items[0].id,
  { count: 500, confidence: 99 },
  2000000,
);
assert.equal(
  loaded.state.items[0].used,
  1007,
  "Reloading establishes a fresh baseline",
);
loaded.reset();
assert.equal(loaded.state.items[0].used, 0);
assert.equal(loaded.rate(loaded.state.items[0], 2000000), null);
for (let i = 0; i < 11; i++) s.add("item" + i, region, 1000, 1000);
assert.equal(s.add("thirteenth", region, 1000, 1000), null);

const { dom, packedFrame } = require("./test-helpers.cjs"),
  Layout = require("../quickslot-layout"),
  cases = require("./quickslot-layout-fixtures.json");
for (const f of cases) {
  const im = packedFrame(f),
    found = Layout.detect(im);
  assert.equal(found?.count, f.expected, f.name);
  for (const [slot, count] of Object.entries(f.expectedCounts || {})) {
    const q = found.slots[slot].quantity,
      crop = require("../hud-regions").crop(im, {
        x: q.x * im.width,
        y: q.y * im.height,
        w: q.w * im.width,
        h: q.h * im.height,
      });
    assert.equal(
      Q.recognizeSlot(crop)?.count,
      count,
      f.name + " complete automatic quantity in slot " + slot,
    );
  }
  for (const slot of f.unreadableSlots || []) {
    const q = found.slots[slot].quantity,
      crop = require("../hud-regions").crop(im, {
        x: q.x * im.width,
        y: q.y * im.height,
        w: q.w * im.width,
        h: q.h * im.height,
      });
    assert.equal(
      Q.recognizeSlot(crop),
      null,
      "Skill/empty tile must not invent quantity: " + f.name + " " + slot,
    );
  }
  assert.equal(found.cols, 4);
  assert.equal(found.slots.length, f.expected);
  assert.equal(
    Layout.detect(im, found)?.count,
    f.expected,
    "Cached control anchoring must retain the real layout",
  );
  const blank = packedFrame({
    ...f,
    patches: f.patches.filter((p) => p.role === "controls"),
  });
  assert.equal(
    Layout.detect(blank),
    null,
    "Controls alone do not imply a slot layout",
  );
}
const ref = cases.find((f) => f.expected === 12),
  refImage = packedFrame(ref),
  refLayout = Layout.detect(refImage),
  covered = { ...refImage, data: new Uint8ClampedArray(refImage.data) };
for (
  let y = Math.max(0, Math.floor(refLayout.box.y) - 5);
  y < refLayout.box.y + refLayout.box.h / 3;
  y++
)
  for (
    let x = Math.max(0, Math.floor(refLayout.box.x) - 5);
    x < refLayout.box.x + refLayout.box.w + 5;
    x++
  ) {
    const p = (y * covered.width + x) * 4;
    covered.data[p] = covered.data[p + 1] = covered.data[p + 2] = 0;
  }
assert.equal(
  Layout.detect(covered),
  null,
  "A covered third row must not silently become an eight-slot layout",
);
for (const f of [cases[10], ref])
  for (const scale of [0.75, 1.25]) {
    const src = packedFrame(f),
      w = Math.round(src.width * scale),
      h = Math.round(src.height * scale),
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const a =
            (Math.min(src.height - 1, Math.floor(y / scale)) * src.width +
              Math.min(src.width - 1, Math.floor(x / scale))) *
            4,
          b = (y * w + x) * 4;
        data[b] = src.data[a];
        data[b + 1] = src.data[a + 1];
        data[b + 2] = src.data[a + 2];
        data[b + 3] = 255;
      }
    assert.equal(
      Layout.detect({ width: w, height: h, data })?.count,
      f.expected,
      "Scaled actual HUD preserves row count",
    );
  }
const eight = packedFrame(cases.find((f) => f.name === "native-8-10")),
  twelve = packedFrame(cases.find((f) => f.expected === 12)),
  frame = (im) => ({ width: im.width, height: im.height, _pixels: im }),
  d = dom(),
  capture = { stream: {} },
  ui = Items.mount({ ...d, storage, getCapture: () => capture });
(async () => {
  await ui.process(frame(eight), 1000);
  assert.equal(ui.layout.count, 8);
  assert.equal(
    ui.store.state.enabled,
    false,
    "Detection does not opt users into count tracking",
  );
  assert.ok(ui.assignSlot(1, "red"));
  assert.ok(ui.assignSlot(2, "mana"));
  assert.equal(ui.store.state.items.length, 2);
  await ui.process(frame(eight), 11000);
  assert.equal(
    ui.store.state.items.find((i) => i.slot === 1).count,
    66,
    "Automatic region excludes the bone graphic that resembles an extra 6",
  );
  assert.equal(ui.store.state.items.find((i) => i.slot === 2).count, 305);
  await ui.process(frame(twelve), 21000);
  assert.equal(ui.layout.count, 12);
  assert.equal(
    ui.store.state.items.length,
    0,
    "A different layout must not silently inherit slot assignments",
  );
  assert.ok(ui.assignSlot(11, "other"));
  assert.equal(ui.assignSlot(12, "red"), false);
  await ui.process(frame(eight), 31000);
  assert.equal(
    ui.store.state.items.find((i) => i.slot === 1).potionType,
    "red",
    "Eight-slot choices survive a layout switch",
  );
  assert.equal(
    ui.store.state.items.find((i) => i.slot === 1).used,
    0,
    "Do not count the period spent in the other layout",
  );
  const blank = packedFrame({ ...cases[10], patches: [] });
  await ui.process(frame(blank), 41000);
  assert.equal(ui.layout, null);
  assert.equal(ui.store.state.items[0].count, 66);
  ui.resetSession();
  assert.equal(ui.store.state.items[0].used, 0);
  ui.dispose();
  const a = Items.createStore({ storage, key: "profile-a" }),
    b = Items.createStore({ storage, key: "profile-b" });
  a.add("A", region, 1000, 1000, null, { slot: 0, potionType: "red" });
  assert.equal(b.state.items.length, 0);
  assert.equal(
    Items.createStore({ storage, key: "profile-a" }).state.items[0].potionType,
    "red",
    "Persist potion type and position independently for each profile",
  );
  const d2 = dom();
  let active,
    hold = true,
    slotJobs = 0;
  d2.window.location = { href: "https://example.test/tracker/" };
  d2.window.setTimeout = () => 1;
  d2.window.clearTimeout = () => {};
  d2.window.Worker = class {
    constructor(url) {
      active = this;
      this.url = url;
    }
    postMessage(m) {
      if (m.kind === "slot") slotJobs++;
      if (!hold)
        queueMicrotask(() => {
          const result =
            m.kind === "layout"
              ? Layout.scan({ ...m.geometry, patch: m.image })
              : Q.recognizeSlot(m.image);
          this.onmessage?.({ data: { id: m.id, result } });
        });
    }
    terminate() {
      this.stopped = true;
    }
  };
  const ui2 = Items.mount({
    ...d2,
    storage: { getItem: () => null, setItem() {} },
    getCapture: () => capture,
  });
  const pending = ui2.process(frame(eight), 1000);
  assert.match(active.url.href, /tracker\/quickslot-worker.js\?v=8$/);
  ui2.invalidate();
  await pending;
  assert.equal(active.stopped, true);
  assert.equal(
    ui2.layout,
    null,
    "A cancelled layout read must not update the UI",
  );
  hold = false;
  await ui2.process(frame(eight), 2000);
  ui2.assignSlot(1, "red");
  await ui2.process(frame(eight), 12000);
  assert.equal(ui2.store.state.items[0].count, 66);
  const before = slotJobs;
  await ui2.process(frame(eight), 22000);
  assert.equal(slotJobs, before, "Unchanged quantities reuse their result");
  ui2.dispose();
  assert.equal(active.stopped, true);
  const { createContext, runInContext } = require("node:vm"),
    messages = [],
    scope = {
      self: { postMessage: (m) => messages.push(m) },
      importScripts: (...files) => {
        for (const file of files)
          runInContext(fs.readFileSync(file.split("?")[0], "utf8"), ctx);
      },
      Uint8Array,
      Uint8ClampedArray,
      Float32Array,
      Map,
      Set,
      Math,
      Number,
    };
  scope.globalThis = scope;
  const ctx = createContext(scope);
  runInContext(fs.readFileSync("quickslot-worker.js", "utf8"), ctx);
  const p = Layout.prepare(twelve),
    { patch, ...geometry } = p;
  scope.self.onmessage({
    data: { id: 8, kind: "layout", image: patch, geometry },
  });
  assert.equal(
    messages[0].result.count,
    12,
    "The actual worker entry point detects the real 12-slot reference",
  );
  const sequence = require("./quickslot-sequence-fixtures.json"),
    rejected = [],
    smallUI = Items.mount({
      ...dom(),
      storage: { getItem: () => null, setItem() {} },
      getCapture: () => capture,
      onRejectedFrame: (...args) => rejected.push(args),
    });
  await smallUI.process(
    frame(packedFrame(sequence[0])),
    sequence[0].timestamp - 10000,
  );
  for (const slot of [1, 2, 3, 5, 7])
    smallUI.assignSlot(slot, slot === 2 ? "mana" : "hp");
  for (const f of sequence) {
    const source = frame(packedFrame(f));
    await smallUI.process(source, f.timestamp);
    for (const [slot, count] of Object.entries(f.expectedCounts))
      assert.equal(
        smallUI.store.state.items.find((i) => i.slot === Number(slot)).count,
        count,
        "Native declining quantity " + f.name + " slot " + slot,
      );
  }
  const hp = smallUI.store.state.items.find((i) => i.slot === 1),
    mp = smallUI.store.state.items.find((i) => i.slot === 2);
  assert.equal(hp.used, 1);
  assert.equal(mp.used, 2);
  assert.ok(Math.abs(smallUI.store.rate(hp, sequence.at(-1).timestamp) - 90) < 0.02);
  assert.ok(Math.abs(smallUI.store.rate(mp, sequence.at(-1).timestamp) - 180) < 0.02);
  assert.equal(
    rejected.length,
    0,
    "Successful count reads do not request downloads",
  );
  smallUI.assignSlot(0, "other");
  smallUI.assignSlot(6, "other");
  const failedFrame = frame(packedFrame(sequence[3])),
    t = sequence[3].timestamp + 10000;
  await smallUI.process(failedFrame, t);
  assert.equal(
    rejected.length,
    1,
    "Multiple unreadable assigned slots request one actual frame",
  );
  assert.equal(rejected[0][0], failedFrame);
  assert.equal(rejected[0][1], t);
  assert.equal(rejected[0][2](), false);
  await smallUI.process(failedFrame, t + 10000, () => true);
  assert.equal(rejected.length, 1, "Cancelled reads cannot request downloads");
  smallUI.store.enable(false);
  await smallUI.process(failedFrame, t + 20000);
  assert.equal(
    rejected.length,
    1,
    "Disabled potion tracking cannot request downloads",
  );
  smallUI.dispose();
  const fresh = cases.filter((f) => f.name.startsWith("fresh-quantity-")),
    freshUI = Items.mount({
      ...dom(),
      storage: { getItem: () => null, setItem() {} },
      getCapture: () => capture,
    });
  await freshUI.process(
    frame(packedFrame(fresh[0])),
    fresh[0].timestamp - 10000,
  );
  freshUI.assignSlot(1, "hp");
  freshUI.assignSlot(2, "mp");
  for (const f of fresh)
    await freshUI.process(frame(packedFrame(f)), f.timestamp);
  assert.equal(freshUI.store.state.items[0].count, 160);
  assert.equal(freshUI.store.state.items[0].used, 3);
  assert.equal(freshUI.store.state.items[1].count, 323);
  assert.equal(freshUI.store.state.items[1].used, 0);
  freshUI.dispose();
  const smallImage = packedFrame(sequence[0]),
    sl = Layout.detect(smallImage).slots[2].quantity,
    smallCrop = require("../hud-regions").crop(smallImage, {
      x: sl.x * smallImage.width,
      y: sl.y * smallImage.height,
      w: sl.w * smallImage.width,
      h: sl.h * smallImage.height,
    });
  scope.self.onmessage({ data: { id: 9, kind: "slot", image: smallCrop } });
  assert.equal(
    messages[1].result.count,
    232,
    "Actual worker imports the small-font decoder",
  );
  console.log(
    "Quickslots: real 8/12-slot HUDs, automatic quantities, potion assignments, separate saved layouts, usage/refills, cancellation, missing panels, worker imports and cached counts passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
