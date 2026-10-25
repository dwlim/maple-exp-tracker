const assert = require("node:assert/strict"),
  Capture = require("../capture"),
  S = require("../session"),
  L = require("../level-ocr"),
  { dom } = require("./test-helpers.cjs");
async function run({
  times = [1, 2],
  outcomes = [{ accepted: true, retry: false }],
  debug = false,
  paused = false,
  cancel = null,
  automatic = true,
  frameCounts = null,
  decodeError = null,
  onFrame = async () => {},
} = {}) {
  let clock = 0,
    decodes = 0,
    encodes = 0;
  const calls = [],
    canvases = [],
    delays = [],
    downloads = [],
    statuses = [],
    d = dom(),
    session = S.create({ levelOcr: L }),
    video = d.node("#sharePreview");
  Object.assign(video, { readyState: 2, videoWidth: 800, videoHeight: 600 });
  Object.defineProperty(video, "currentTime", { get: () => times[clock] });
  if (frameCounts)
    video.getVideoPlaybackQuality = () => ({
      totalVideoFrames: frameCounts[clock],
    });
  const create = d.document.createElement;
  d.document.createElement = (kind) => {
    const frame = create(kind);
    if (kind === "canvas") {
      canvases.push(frame);
      frame.toBlob = (fn) => {
        encodes++;
        fn({});
      };
    }
    return frame;
  };
  const track = { stop() {}, addEventListener() {} },
    stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  let controller;
  const view = {
    update() {},
    status() {},
    isAutomatic: () => automatic,
    previewFrame: async (f) => {
      const blob = await new Promise((resolve) => f.toBlob(resolve));
      f._pngBlob = blob;
    },
    captureError(stage, e) {
      statuses.push(stage + ": " + e.message);
    },
    appendOutput() {},
    timing() {},
  };
  const debugTools = {
    rejectFrame: async (frame, t) => {
      if (!frame._pngBlob)
        await new Promise((resolve) => frame.toBlob(resolve));
      downloads.push({ frame, t, accepted: false });
    },
  };
  controller = Capture.create({
    navigator: { mediaDevices: { getDisplayMedia: async () => stream } },
    video,
    document: d.document,
    session,
    debug,
    view,
    debugTools,
    onFrame,
    now: () => 1700000000000 + clock * 250,
    recognition: {
      reset() {},
      decodeFrame(f) {
        assert.ok(f.width && f.height);
        decodes++;
        if (decodeError) throw Error(decodeError);
        if (cancel === "decode") controller.invalidate();
      },
    },
    reader: {
      read: async (frame, t, options) => {
        calls.push({ frame, t, options });
        return outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
      },
    },
    timers: {
      setTimeout(fn, ms) {
        delays.push(ms);
        if (ms === 250) clock++;
        if (cancel === "yield" || (cancel === "retry" && ms === 250))
          controller.invalidate();
        fn();
      },
      setInterval() {},
      clearInterval() {},
    },
  });
  if (paused) {
    video.readyState = 0;
    await controller.connect();
    video.readyState = 2;
    session.state.paused = true;
    await controller.captureFrame();
  } else await controller.connect();
  return {
    controller,
    session,
    calls,
    canvases,
    decodes,
    encodes,
    delays,
    downloads,
    statuses,
  };
}
(async () => {
  let itemFrames = 0;
  const withItems = await run({
    outcomes: [{ accepted: false, retry: false }],
    onFrame: async (frame, t, cancelled) => {
      assert.ok(frame.width && frame.height);
      assert.equal(cancelled(), false);
      itemFrames++;
    },
  });
  assert.equal(itemFrames, 1, "Item tracking runs even when EXP is rejected");
  assert.equal(
    withItems.canvases.length,
    1,
    "Items reuse the existing capture",
  );
  const clear = await run();
  assert.equal(clear.decodes, 1);
  assert.equal(clear.canvases.length, 1);
  assert.equal(clear.calls.length, 1);
  assert.equal(clear.encodes, 0);
  assert.ok(!clear.delays.includes(250));
  assert.equal(clear.calls[0].t, clear.calls[0].frame._capturedAt);
  const retry = await run({
    outcomes: [
      { accepted: false, retry: true },
      { accepted: true, retry: false },
    ],
  });
  assert.equal(retry.decodes, 2);
  assert.equal(retry.canvases.length, 2);
  assert.equal(retry.calls.length, 2);
  assert.notEqual(retry.calls[0].frame, retry.calls[1].frame);
  assert.ok(retry.calls[1].t > retry.calls[0].t);
  assert.equal(retry.calls[0].options.report, false);
  const frozen = await run({
    times: [1, 1],
    outcomes: [{ accepted: false, retry: true }],
  });
  assert.equal(frozen.decodes, 1);
  assert.equal(frozen.calls[0].t, frozen.calls[1].t);
  const stalled = await run({
    times: [1, 2],
    frameCounts: [10, 10],
    outcomes: [{ accepted: false, retry: true }],
  });
  assert.equal(stalled.decodes, 1);
  const advanced = await run({
    times: [1, 1],
    frameCounts: [10, 11],
    outcomes: [
      { accepted: false, retry: true },
      { accepted: true, retry: false },
    ],
  });
  assert.equal(advanced.decodes, 2);
  const mismatch = await run({ outcomes: [{ accepted: false, retry: false }] });
  assert.equal(mismatch.decodes, 1);
  assert.ok(!mismatch.delays.includes(250));
  const paused = await run({ paused: true });
  assert.equal(paused.decodes, 0);
  assert.equal(paused.canvases.length, 0);
  for (const cancel of ["yield", "decode", "retry"]) {
    const p = await run({
      cancel,
      outcomes: [{ accepted: false, retry: true }],
    });
    assert.ok(p.calls.length < 2);
    assert.equal(p.controller.busy, false);
    assert.ok(p.canvases.every((f) => f.width === 0 && f.height === 0));
  }
  const diagnostic = await run({
    debug: true,
    outcomes: [
      { accepted: false, retry: true },
      { accepted: false, retry: false },
    ],
  });
  assert.equal(diagnostic.encodes, 1);
  assert.ok(diagnostic.calls.at(-1).frame._pngBlob);
  const failure = await run({
    debug: true,
    decodeError: "Test recognition failure",
  });
  assert.match(
    failure.statuses.at(-1),
    /recognition: Test recognition failure/,
  );
  assert.equal(failure.downloads.length, 1);
  assert.equal(failure.controller.busy, false);
  const privateFailure = await run({ decodeError: "Test recognition failure" });
  assert.equal(privateFailure.downloads.length, 0);
  const manual = await run({ automatic: false });
  assert.equal(manual.decodes, 0);
  assert.equal(manual.encodes, 1);
  assert.equal(manual.calls.length, 0);
  for (const p of [
    clear,
    retry,
    frozen,
    mismatch,
    diagnostic,
    manual,
    failure,
  ]) {
    assert.equal(p.controller.busy, false);
    assert.ok(
      p.canvases.every((f) => f.width === 0 && f.height === 0 && !f._pixels),
    );
  }
  clear.controller.togglePause();
  assert.equal(clear.session.state.paused, true);
  assert.equal(clear.session.state.running, false);
  assert.ok(clear.controller.stream);
  clear.controller.togglePause();
  assert.equal(clear.session.state.paused, false);
  clear.controller.stop();
  clear.controller.togglePause();
  assert.equal(clear.session.state.paused, false);
  console.log(
    "Capture controller: clear frames, fresh retry, decoder freshness, cancellation, debug errors, cleanup and pause/resume passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
