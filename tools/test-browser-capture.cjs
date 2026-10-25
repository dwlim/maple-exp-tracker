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
    intervalMs,
    cleared = false;
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
    reader: { read: async () => ({ accepted: true }) },
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
        intervalMs = ms;
        return 1;
      },
      clearInterval() {
        cleared = true;
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
    get intervalMs() {
      return intervalMs;
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
  assert.equal(f.intervalMs, 10000);
  assert.equal(f.captured, 1);
  assert.equal(f.c.stream, stream);
  ended();
  assert.equal(stopped, 1);
  assert.equal(f.c.stream, null);
  assert.equal(f.session.state.samples[0].exp, 123);
  assert.ok(f.cleared);
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
    assert.deepEqual(
      d.timers.map((t) => t.ms),
      [5000],
    );
    assert.ok(stored.has("maple-track-v1"));
    app.dispose();
    assert.ok(!d.events.has("window:pagehide"));
  }
  console.log(
    "Browser capture: direct startup, ten-second scheduling, permissions, cleanup, cancellation, app boot and disposal passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
