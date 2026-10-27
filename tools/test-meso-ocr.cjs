const assert = require("node:assert/strict"),
  Ocr = require("../local-ocr"),
  Reader = require("../reader");

assert.equal(Ocr.parseMeso("1,180,795"), 1180795);
assert.equal(Ocr.parseMeso("1180795"), 1180795);
assert.equal(Ocr.parseMeso("1,18,795"), null);
assert.equal(Ocr.parseMeso("3"), 3);
assert.equal(Ocr.parseMeso("1,132,963 MESOS"), null);
const source = { width: 4, height: 3, data: new Uint8ClampedArray(4 * 3 * 4) };
for (let i = 0; i < source.data.length; i++) source.data[i] = i % 256;
const selected = Reader.cropNormalized(source, { x: 0.25, y: 0, w: 0.5, h: 1 });
assert.equal(selected.width, 2);
assert.equal(selected.height, 3);
assert.deepEqual(
  [...selected.data.slice(0, 8)],
  [...source.data.slice(4, 12)],
  "Normalized ROI crop preserves source pixels",
);

(async () => {
  const image = {
    width: 143,
    height: 17,
    data: new Uint8ClampedArray(143 * 17 * 4).fill(255),
  };
  for (let i = 0; i < image.data.length * 0.08; i += 4)
    image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
  assert.equal(Ocr.isMesoField(image), true);
  assert.equal(Ocr.isMesoField({ ...image, data: new Uint8ClampedArray(image.data.length).fill(255) }), false);

  const kinds = [];
  let preview = null;
  const result = await Ocr.readMesoAmount(image, async (pixels, kind) => {
    kinds.push(kind);
    assert.equal(pixels.width, 143 * 4 + 32);
    assert.equal(pixels.height, 17 * 4 + 32);
    return { text: "1,132,963", confidence: kind.endsWith("binary") ? 88 : 94 };
  }, image, (pixels) => { preview = pixels; });
  assert.equal(preview?.width, 143 * 4 + 32, "debug preview is the preprocessed OCR input");
  assert.equal(preview?.height, 17 * 4 + 32, "debug preview is the preprocessed OCR input");
  assert.deepEqual(result, { amount: 1132963, confidence: 88 });
  assert.deepEqual(kinds, ["meso-value", "meso-value-binary"]);

  const mismatch = await Ocr.readMesoAmount(image, async (_pixels, kind) => ({
    text: kind.endsWith("binary") ? "1,132,968" : "1,132,963",
    confidence: 95,
  }), image);
  assert.equal(mismatch, null, "different preprocessing results must not be saved");
  const lowConfidence = await Ocr.readMesoAmount(image, async () => ({
    text: "1,132,963",
    confidence: 39,
  }), image);
  assert.equal(lowConfidence, null);

  let mesoReads = 0;
  const capture = { generation: 1, stream: {} },
    state = {
      paused: false,
      startAt: 10,
      mesoRegion: { x: 0, y: 0, w: 1, h: 1 },
      samples: [],
      mesoSamples: [],
    },
    session = {
      state,
      validate: () => ({ valid: true, level: 60, exp: 100, continuity: {}, levelResolution: {} }),
      addSample() {},
      addMesoSample(amount, t) { state.mesoSamples.push({ amount, t }); },
      setMesoStatus(status) { state.mesoStatus = status; },
      clearPending() {},
    },
    view = {
      reading() {},
      renderReading() {},
      saved() {},
      status() {},
      output() {},
    },
    reader = Reader.create({
      session,
      recognition: { async decodeFrame() {} },
      view,
      getCapture: () => capture,
      localOcr: {
        read() {
          mesoReads++;
          return mesoReads === 1
            ? Promise.resolve({ meso: { amount: 1132963 } })
            : Promise.reject(Error("temporary meso OCR failure"));
        },
      },
    }),
    frame = {
      _pixels: image,
      _hudRegions: { exp: {} },
      _reading: { levelResult: {}, expResult: {} },
    };
  assert.equal((await reader.read(frame, 1700000000000)).accepted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.mesoSamples[0].amount, 1132963);
  assert.equal((await reader.read(frame, 1700000010000)).accepted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.mesoStatus, "Meso read unavailable · EXP tracking continues");

  const scanInputs = [],
    scanState = { paused: false, startAt: 20, samples: [], mesoSamples: [] },
    scanCapture = { generation: 2, stream: {} },
    scanSession = {
      state: scanState,
      validate: () => ({ valid: true, level: 60, exp: 100, continuity: {}, levelResolution: {} }),
      addSample() {},
      addMesoSample(amount, t) { scanState.mesoSamples.push({ amount, t }); },
      setMesoStatus(status) { scanState.mesoStatus = status; },
      clearPending() {},
    },
    scanReader = Reader.create({
      session: scanSession,
      recognition: { async decodeFrame() {} },
      view,
      getCapture: () => scanCapture,
      getMesoReference: async () => ({ features: ["loaded-reference"] }),
      localOcr: {
        read(input) { scanInputs.push(input); return Promise.resolve(null); },
      },
    });
  assert.equal((await scanReader.read(frame, 1700000120000)).accepted, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scanInputs.length, 1, "reference loading must invoke OCR once");
  assert.deepEqual(scanInputs[0].mesoReference, { features: ["loaded-reference"] });
  console.log("Meso OCR: grouped amounts, scaled crop preprocessing, confidence and exact agreement passed.");
})();
