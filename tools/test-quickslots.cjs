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
assert.deepEqual(
  new Set(require("../quickslot-font").map((v) => v.digit)),
  new Set("0123456789"),
);
for (const value of [0, 100, 255])
  assert.equal(
    Q.recognize({
      width: 30,
      height: 16,
      data: new Uint8Array(30 * 16 * 4).fill(value),
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
assert.equal(s.rate(item), null);
read(996, 20);
read(995, 30);
assert.equal(item.used, 5);
assert.equal(s.rate(item), 600);
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
assert.equal(loaded.rate(loaded.state.items[0]), null);
for (let i = 0; i < 7; i++) s.add("item" + i, region, 1000, 1000);
assert.equal(s.add("ninth", region, 1000, 1000), null);
const { dom } = require("./test-helpers.cjs"),
  d = dom(),
  video = d.node("#video"),
  capture = { stream: {} },
  ui = Items.mount({
    ...d,
    video,
    storage: { getItem: () => null, setItem() {} },
    getCapture: () => capture,
  });
assert.equal(d.node("#trackItems").checked, false, "Item tracking is opt-in");
const f = fixtures.find((f) => f.text === "305"),
  image = {
    width: f.width,
    height: f.height,
    data: z.inflateSync(Buffer.from(f.rgba, "base64")),
  };
const tracked = ui.store.add(
  "<script>HP</script>",
  { x: 0, y: 0, w: 1, h: 1 },
  f.width,
  f.height,
);
ui.store.enable(true);
(async () => {
  const frame = { width: image.width, height: image.height, _pixels: image };
  await ui.process(frame, 1000);
  assert.equal(
    tracked.count,
    305,
    "The real matcher feeds the item store through the capture hook",
  );
  await ui.process(frame, 11000);
  assert.equal(tracked.used, 0);
  await ui.process(
    {
      ...frame,
      _pixels: {
        ...image,
        width: image.width + 1,
        data: new Uint8Array((image.width + 1) * image.height * 4),
      },
    },
    21000,
  );
  assert.match(tracked.status, /size changed/);
  assert.equal(tracked.count, 305);
  ui.invalidate();
  assert.equal(tracked.at, null);
  ui.dispose();
  const d2 = dom();
  let activeWorker,
    jobs = 0;
  d2.window.location = { href: "https://example.test/tracker/" };
  d2.window.setTimeout = () => 1;
  d2.window.clearTimeout = () => {};
  d2.window.Worker = class {
    constructor(url) {
      this.url = url;
      activeWorker = this;
    }
    postMessage(m) {
      this.message = m;
      jobs++;
    }
    terminate() {
      this.stopped = true;
    }
  };
  const ui2 = Items.mount({
      ...d2,
      video: d2.node("#video"),
      storage: { getItem: () => null, setItem() {} },
      getCapture: () => capture,
    }),
    i2 = ui2.store.add(
      "MP",
      { x: 0, y: 0, w: 1, h: 1 },
      image.width,
      image.height,
    );
  ui2.store.enable(true);
  const pending = ui2.process(
    { width: image.width, height: image.height, _pixels: image },
    1000,
  );
  assert.match(activeWorker.url.href, /tracker\/quickslot-worker.js$/);
  ui2.invalidate();
  await pending;
  assert.equal(activeWorker.stopped, true);
  assert.equal(
    i2.count,
    null,
    "A stopped or reconfigured worker must not save its outstanding result",
  );
  const work = ui2.process(
    { width: image.width, height: image.height, _pixels: image },
    2000,
  );
  activeWorker.onmessage({
    data: { id: activeWorker.message.id, result: Q.recognize(image) },
  });
  await work;
  assert.equal(i2.count, 305);
  const before = jobs;
  await ui2.process(
    { width: image.width, height: image.height, _pixels: image },
    12000,
  );
  assert.equal(jobs, before, "Unchanged count pixels reuse their result");
  ui2.dispose();
  assert.equal(
    activeWorker.stopped,
    true,
    "Page disposal terminates the item worker",
  );
  const { createContext, runInContext } = require("node:vm"),
    messages = [],
    scope = {
      self: { postMessage: (m) => messages.push(m) },
      importScripts: (...files) => {
        for (const file of files)
          runInContext(fs.readFileSync(file, "utf8"), ctx);
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
  scope.self.onmessage({ data: { id: 7, image } });
  assert.equal(messages[0].id, 7);
  assert.equal(
    messages[0].result.count,
    305,
    "Actual worker entry point imports the real font and matcher",
  );
  console.log(
    `Quickslots: ${fixtures.length} manually transcribed quantity crops, blank rejection, real worker pipeline, usage, restocks, fresh confirmation, pause/reload, bounded settings and resolution changes passed.`,
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
