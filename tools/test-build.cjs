const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { render } = require("./embed-script.cjs");
const html = fs.readFileSync("index.html", "utf8"),
  source = fs.readFileSync("hud-regions.js", "utf8"),
  next = render(html, "HUD REGIONS", source);
assert.match(html, /<link\s+rel="stylesheet"\s+href="\.\/dashboard\.css"\s*\/>/);
assert.ok(fs.existsSync("dashboard.css"), "Dashboard stylesheet is present");
assert.match(
  fs.readFileSync(".github/workflows/pages.yml", "utf8"),
  /cp dashboard\.css _site\/dashboard\.css/,
  "Pages deployment publishes the dashboard stylesheet",
);
assert.equal(
  render(next, "HUD REGIONS", source),
  next,
  "Embedding must be idempotent",
);
const order = (s) =>
  [...s.matchAll(/<!-- ([A-Z ]+) START -->/g)].map((m) => m[1]);
assert.deepEqual(
  order(next),
  order(html),
  "Rebuilding a module must preserve script order",
);
assert.equal(
  next.slice(next.indexOf("</head>")),
  html.slice(html.indexOf("</head>")),
  "Embedding never changes application code or markup",
);
assert.throws(
  () => render("<head></head>", "HUD REGIONS", source),
  /Missing or duplicate/,
);
console.log(
  "Build: deterministic embedding, module order, application preservation and missing markers passed.",
);
// Run the assembled browser scripts in order; behavioral tests above import modules directly.
const vm = require("node:vm"),
  { dom } = require("./test-helpers.cjs"),
  d = dom(),
  store = new Map();
const browser = {
  ...d.window,
  document: d.document,
  navigator: {},
  location: { search: "", href: "https://example.test/maple-exp-tracker/" },
  localStorage: {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, v),
  },
  URLSearchParams,
  URL,
  console,
  Uint8ClampedArray,
  Uint8Array,
  Float32Array,
  Uint32Array,
  Map,
  Set,
  Date,
};
browser.window = browser;
vm.createContext(browser);
for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
  vm.runInContext(script[1], browser);
assert.equal(
  d.node("#liveState").textContent,
  "READY",
  "Assembled browser script order must boot the dashboard",
);
assert.ok(d.events.has("#shareGameBtn:click"));
assert.equal(d.timers.at(-1).ms, 5000);
console.log("Assembled browser entry point boots with the embedded modules.");
