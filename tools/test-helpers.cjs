const R = require("../hud-regions"),
  S = require("../session"),
  L = require("../level-ocr"),
  Recognition = require("../recognition"),
  Reader = require("../reader"),
  Dashboard = require("../dashboard");
require("../hud-ocr");
function dom(image = null) {
  const nodes = new Map(),
    events = new Map(),
    timers = [],
    urls = [];
  let id = 0;
  const node = (name) => {
    if (nodes.has(name)) return nodes.get(name);
    const classes = new Set();
    const n = {
      style: {},
      dataset: {},
      textContent: "",
      innerHTML: "",
      checked: true,
      naturalWidth: 0,
      naturalHeight: 0,
      width: 0,
      height: 0,
      readyState: 0,
      videoWidth: 0,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle(c, on) {
          if (on === undefined) on = !classes.has(c);
          on ? classes.add(c) : classes.delete(c);
        },
        contains: (c) => classes.has(c),
      },
      addEventListener(type, fn) {
        events.set(name + ":" + type, fn);
      },
      removeEventListener(type) {
        events.delete(name + ":" + type);
      },
      setAttribute(k, v) {
        this[k] = v;
      },
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
      setPointerCapture() {},
      insertAdjacentHTML(_, s) {
        this.innerHTML += s;
      },
      appendChild() {},
      remove() {},
      click() {
        events.get(name + ":click")?.();
      },
      after() {},
      pause() {},
      play: async () => {},
    };
    Object.defineProperty(n, "src", {
      get() {
        return this._src;
      },
      set(v) {
        this._src = v;
        this.onload?.();
      },
    });
    nodes.set(name, n);
    return n;
  };
  function canvas() {
    const c = node("canvas-" + id++);
    let rect = null;
    c.getContext = () => ({
      drawImage(...a) {
        if (a.length > 3) rect = { x: a[1], y: a[2], w: a[3], h: a[4] };
      },
      getImageData(x, y, w, h) {
        if (!image) throw Error("No test pixels");
        return rect ? R.crop(image, rect) : R.crop(image, { x, y, w, h });
      },
      putImageData() {},
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      fillText() {},
      setLineDash() {},
    });
    c.toBlob = (fn) => fn({ snapshot: c });
    c.toDataURL = () => "data:image/png;base64,test";
    return c;
  }
  const document = {
    querySelector: node,
    body: node("body"),
    createElement: (kind) =>
      kind === "canvas" ? canvas() : node(kind + "-" + id++),
  };
  const window = {
    URL: {
      createObjectURL() {
        const url = "blob:test-" + id++;
        urls.push(url);
        return url;
      },
      revokeObjectURL(url) {
        urls.splice(urls.indexOf(url), 1);
      },
    },
    ImageData: class {
      constructor(data, width, height) {
        Object.assign(this, { data, width, height });
      }
    },
    setTimeout(fn) {
      fn();
      return ++id;
    },
    setInterval(fn, ms) {
      timers.push({ fn, ms, id: ++id });
      return id;
    },
    clearInterval() {},
    addEventListener(type, fn) {
      events.set("window:" + type, fn);
    },
    removeEventListener(type) {
      events.delete("window:" + type);
    },
    confirm: () => true,
    prompt: () => null,
    open: () => ({ focus() {} }),
  };
  return { node, document, window, events, timers, urls, canvas };
}
function pipeline({
  image = null,
  localOcr,
  debug = false,
  storage = null,
} = {}) {
  const d = dom(image);
  let capture = { stream: {}, generation: 1 };
  const session = S.create({
    storage,
    levelOcr: L,
    onChange: () => view.update(),
  });
  const recognition = Recognition.create({
    document: d.document,
    state: session.state,
    levelOcr: L,
    hudOcr: MapleHudOcr,
    hudRegions: R,
    localOcr,
    required: S.required,
    getImage: () => d.node("#latestFrame"),
    debug,
    onExpPreview: (p) => view.showExpPreview(p),
  });
  const view = Dashboard.create({
    document: d.document,
    window: d.window,
    session,
    recognition,
    getCapture: () => capture,
    debug,
  });
  const downloads = [],
    debugTools = {
      rejectFrame: async (frame, t) => downloads.push({ frame, t }),
    };
  const reader = Reader.create({
    session,
    recognition,
    view,
    debugTools,
    getCapture: () => capture,
    debug,
  });
  return {
    ...d,
    session,
    recognition,
    reader,
    view,
    downloads,
    debugTools,
    get capture() {
      return capture;
    },
    set capture(value) {
      capture = value;
    },
  };
}
function packedFrame(f) {
  const image = {
    width: f.width,
    height: f.height,
    data: new Uint8ClampedArray(f.width * f.height * 4),
  };
  for (const p of f.patches) {
    const data =
      p.data || require("zlib").inflateSync(Buffer.from(p.rgba, "base64"));
    for (let y = 0; y < p.height; y++)
      image.data.set(
        data.subarray
          ? data.subarray(y * p.width * 4, (y + 1) * p.width * 4)
          : data.slice(y * p.width * 4, (y + 1) * p.width * 4),
        ((p.y + y) * f.width + p.x) * 4,
      );
  }
  return image;
}
function readingFrame(
  level,
  exp,
  {
    levelConfidence = 95,
    expConfidence = 95,
    uncertain = false,
    percentageOnly,
    rawText = exp,
    rawConfidence = expConfidence,
  } = {},
) {
  return {
    _hudRegions: { level: {}, exp: {} },
    _reading: {
      levelResult: {
        data: { text: level, confidence: levelConfidence },
        expectedDigits: 2,
      },
      expResult: {
        rawText,
        rawConfidence,
        data: { text: exp, confidence: expConfidence },
        uncertain,
        percentageOnly,
      },
    },
  };
}
module.exports = { dom, pipeline, packedFrame, readingFrame };
