const assert = require("node:assert/strict"),
  Capture = require("../capture"),
  S = require("../session"),
  L = require("../level-ocr"),
  App = require("../app"),
  { dom } = require("./test-helpers.cjs");
function fixture(getDisplayMedia) {
  const d = dom(),
    session = S.create({ levelOcr: L });
  session.state.samples = [{ exp: 123 }];
  const video = d.node("#sharePreview");
  Object.assign(video, {
    readyState: 2,
    videoWidth: 800,
    videoHeight: 600,
    currentTime: 1,
  });
  let captured = 0,
    status,
    processedItems = 0,
    intervals = [],
    cleared = [];
  const probePixels = {
    width: 400,
    height: 300,
    data: new Uint8ClampedArray(400 * 300 * 4),
  };
  for (let i = 0; i < probePixels.data.length; i += 4) {
    probePixels.data[i] = 40;
    probePixels.data[i + 1] = 90;
    probePixels.data[i + 2] = 170;
    probePixels.data[i + 3] = 255;
  }
  const makeCanvas = () => {
    let width = 0, height = 0;
    return {
      set width(value) { width = value; },
      get width() { return width; },
      set height(value) { height = value; },
      get height() { return height; },
      getContext: () => ({
        drawImage() {},
        getImageData: () => width === probePixels.width && height === probePixels.height
          ? probePixels
          : {
              width,
              height,
              data: new Uint8ClampedArray(width * height * 4).fill(127),
            },
      }),
    };
  };
  d.document.createElement = (kind) => kind === "canvas" ? makeCanvas() : d.document.querySelector(kind);
  const mapProbeReads = [], dropReads = [], reader = {
    read: async (frame, timestamp, options) => {
      mapProbeReads.push(options);
      return { accepted: true };
    },
    observeMapProbe() { return ++probeCount === 2; },
    resetMapProbe() {},
    observeDropProbe() { return ++dropProbeCount === 1; },
    readDropNotice(image, timestamp) { dropReads.push({ image, timestamp }); },
    resetDropProbe() {},
  };
  let probeCount = 0, dropProbeCount = 0;
  const c = Capture.create({
    navigator: { mediaDevices: { getDisplayMedia } },
    video,
    document: d.document,
    session,
    recognition: {
      reset() {},
      decodeFrame() {
        captured++;
      },
    },
    reader,
    onFrame: async () => { processedItems++; },
    view: {
      update() {},
      status(kind, text) {
        status = { kind, text };
      },
      isAutomatic: () => true,
      captureError(stage, error) {
        throw error;
      },
    },
    debugTools: {},
    timers: {
      setTimeout: (fn) => fn(),
      setInterval(fn, ms) {
        intervals.push({ fn, ms });
        return intervals.length;
      },
      clearInterval(id) {
        cleared.push(id);
      },
    },
  });
  return {
    ...d,
    c,
    session,
    video,
    get status() {
      return status;
    },
    get intervals() {
      return intervals;
    },
    get mapProbeReads() {
      return mapProbeReads;
    },
    get dropReads() {
      return dropReads;
    },
    get processedItems() {
      return processedItems;
    },
    get captured() {
      return captured;
    },
    get cleared() {
      return cleared;
    },
  };
}
(async () => {
  let stopped = 0,
    ended;
  const track = {
      stop() {
        stopped++;
      },
      addEventListener(event, fn) {
        assert.equal(event, "ended");
        ended = fn;
      },
    },
    stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const f = fixture(async (options) => {
    assert.equal(options.audio, false);
    assert.equal(options.video.displaySurface, "window");
    return stream;
  });
  await f.c.connect();
  assert.equal(f.session.state.running, true);
  assert.deepEqual(f.intervals.map(({ ms }) => ms), [10000, 2000, 100]);
  assert.equal(f.captured, 1);
  assert.deepEqual(f.mapProbeReads[0], { report: false, forceMap: false });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  assert.equal(f.processedItems, 1, "the regular full scan continues quickslot reads");
  f.intervals[1].fn();
  await flush();
  assert.equal(f.captured, 1, "the first changed probe only begins the stability check");
  f.intervals[1].fn();
  await flush();
  await flush();
  assert.equal(f.captured, 2, "a stable map-header change requests one full-resolution read");
  assert.deepEqual(f.mapProbeReads[1], { report: false, forceMap: true });
  assert.equal(f.processedItems, 1, "a map-change read skips unrelated quickslot OCR");
  f.intervals[2].fn();
  assert.equal(f.dropReads.length, 1, "the first changed feed probe immediately schedules OCR");
  f.video.currentTime = 2;
  f.intervals[2].fn();
  assert.equal(f.dropReads.length, 1, "an unchanged feed does not repeat OCR");
  assert.ok(f.dropReads[0].image, "Drop OCR receives only the cropped notification region");
  assert.equal(f.dropReads[0].image.width, 336, "Drop OCR crop is wide enough for a full item line");
  assert.equal(f.dropReads[0].image.height, 192, "Drop OCR crop preserves the lower notification rows");
  f.intervals[1].fn();
  await flush();
  assert.equal(f.captured, 2, "the probe does not continuously request OCR after a change");
  assert.equal(f.c.stream, stream);
  ended();
  assert.equal(stopped, 1);
  assert.equal(f.c.stream, null);
  assert.equal(f.session.state.samples[0].exp, 123);
  assert.deepEqual(
    f.cleared.filter((id) => id !== null),
    [1, 2, 3],
    "stop clears all bounded scan timers",
  );
  const cancelled = fixture(async () => {
    throw Object.assign(Error("cancelled"), { name: "NotAllowedError" });
  });
  await cancelled.c.connect();
  assert.equal(cancelled.c.stream, null);
  assert.equal(cancelled.c.connecting, false);
  assert.match(cancelled.status.text, /cancelled/);
  const unsupported = fixture(undefined);
  await unsupported.c.connect();
  assert.match(unsupported.status.text, /unavailable/);
  const failed = fixture(async () => stream);
  failed.video.play = async () => {
    throw Error("Video playback unavailable");
  };
  await failed.c.connect();
  assert.equal(failed.c.stream, null);
  assert.equal(failed.session.state.running, false);
  for (const search of [
    "",
    "?capture=obs&overlay=1",
    "?capture=obs&overlay=1&debug=1",
  ]) {
    const d = dom(),
      stored = new Map(),
      storage = {
        getItem: (k) => stored.get(k) || null,
        setItem: (k, v) => stored.set(k, v),
      },
      app = App.mount({
        ...d,
        navigator: {},
        storage,
        location: { search },
        levelOcr: L,
        hudOcr: MapleHudOcr,
        hudRegions: require("../hud-regions"),
      });
    assert.ok(d.events.has("#shareGameBtn:click"));
    assert.equal(d.node(".app").innerHTML, "");
    assert.equal(d.node("#liveState").textContent, "READY");
    assert.deepEqual(d.timers.map((t) => t.ms), [5000]);
    assert.ok(stored.has("maple-track-v1"));
    app.dispose();
    assert.ok(!d.events.has("window:pagehide"));
  }
  console.log(
    "Browser capture: direct startup, ten-second full scans, two-second map probes, permissions, cleanup, cancellation, app boot and disposal passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
