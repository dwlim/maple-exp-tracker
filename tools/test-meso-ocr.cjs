const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { PNG } = require("pngjs"),
  Tesseract = require("tesseract.js"),
  Ocr = require("../local-ocr"),
  Reader = require("../reader");

assert.equal(Ocr.parseMeso("1,180,795"), 1180795);
assert.equal(Ocr.parseMeso("1.180.795"), 1180795);
assert.equal(Ocr.parseMeso("1180795"), 1180795);
assert.equal(Ocr.parseMeso("1,18,795"), null);
assert.equal(Ocr.parseMeso("3"), 3);
assert.equal(Ocr.parseMeso("1,132,963 MESOS"), null);
assert.equal(Ocr.parseMeso("2,147,483,647"), 2147483647);
assert.equal(Ocr.parseMeso("2,147,483,648"), null, "meso balances must stay within the signed 32-bit range");
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

  const kinds = [],
    result = await Ocr.readMesoAmount(image, async (pixels, kind) => {
      kinds.push(kind);
      assert.equal(pixels.width, 143 * 4 + 32);
      assert.equal(pixels.height, 17 * 4 + 32);
      return { text: "1,132,963", confidence: kind.endsWith("binary") ? 88 : 94 };
    });
  assert.deepEqual(result, { amount: 1132963, confidence: 88 });
  assert.deepEqual(kinds, ["meso-value", "meso-value-binary"]);

  const conflicting = await Ocr.readMesoAmount(image, async (_pixels, kind) => ({
    text: kind === "meso-value" ? "1,132,963" : kind === "meso-value-binary" ? "1,132,968" : "1,132,969",
    confidence: 95,
  }));
  assert.equal(conflicting, null, "three conflicting preprocessing results must remain unreadable");
  const recovered = await Ocr.readMesoAmount(image, async (_pixels, kind) => ({
    text: kind === "meso-value-binary" ? "1,132,968" : "1,132,963",
    confidence: kind === "meso-value-adaptive" ? 91 : 95,
  }));
  assert.deepEqual(recovered, { amount: 1132963, confidence: 91 }, "adaptive pass can resolve one differing pass by 2-of-3 agreement");
  const lowConfidence = await Ocr.readMesoAmount(image, async () => ({
    text: "1,132,963",
    confidence: 39,
  }));
  assert.equal(lowConfidence, null);

  const singleFive = PNG.sync.read(fs.readFileSync(path.join(__dirname, "fixtures/meso-single-5.png"))),
    twoDigitNineteen = PNG.sync.read(fs.readFileSync(path.join(__dirname, "fixtures/meso-two-digit-19.png")));
  for (const [fixture, expected] of [
    ["meso-single-5.png", 5], ["meso-two-digit-19.png", 19],
    ["meso-clear-1135117.png", 1135117], ["meso-known-1090609.png", 1090609],
    ["meso-known-1112112.png", 1112112],
    ["meso-known-1100934.png", 1100934], ["meso-known-1101282.png", 1101282],
  ]) {
    const pixels = PNG.sync.read(fs.readFileSync(path.join(__dirname, "fixtures", fixture)));
    assert.equal(Ocr.recognizeMesoDigits(pixels)?.amount, expected, `verified digit templates should read ${expected}`);
  }
  const balanceReference = Ocr.createMesoReference(PNG.sync.read(fs.readFileSync(path.join(__dirname, "../assets/meso-balance-reference.png")))),
    compactBalanceRow = PNG.sync.read(fs.readFileSync(path.join(__dirname, "fixtures/meso-row-single-5.png"))),
    locatedBalance = Ocr.locateMesoReference(compactBalanceRow, balanceReference);
  assert.ok(locatedBalance, "compact balance template should align to the shorter inventory row");
  assert.deepEqual(
    await Ocr.readMesoAmount(locatedBalance.amountImage, async () => ({ text: "", confidence: 0 })),
    { amount: 5, confidence: 100 },
    "verified isolated 5 should be recovered after OCR drops the glyph",
  );
  assert.deepEqual(
    await Ocr.readMesoAmount(twoDigitNineteen, async () => ({ text: "", confidence: 0 })),
    { amount: 19, confidence: 100 },
    "verified 1 and 9 glyphs should be recovered when OCR drops a two-digit balance",
  );
  const threeShape = { width: 148, height: 19, data: new Uint8ClampedArray(148 * 19 * 4).fill(255) },
    threeRows = [".###.", "#...#", "....#", "..##.", "....#", "....#", "#...#", ".###."];
  for (let y = 0; y < threeRows.length; y++)
    for (let x = 0; x < threeRows[y].length; x++)
      if (threeRows[y][x] === "#") {
        const i = ((y + 6) * threeShape.width + x + 138) * 4;
        threeShape.data[i] = threeShape.data[i + 1] = threeShape.data[i + 2] = 0;
      }
  assert.deepEqual(Ocr.recognizeMesoDigits(threeShape), { amount: 3, confidence: 100 }, "single-digit fallback should classify a verified 3");

  const verifiedGlyphs = [
    [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    ["..#..", "###..", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    [".###.", "#...#", "....#", "..##.", "....#", "....#", "#...#", ".###."],
    ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#.", "...#."],
    ["#####", "#....", "#....", "####.", "....#", "....#", "#...#", ".###."],
    ["..##.", ".#...", "#....", "####.", "#...#", "#...#", "#...#", ".###."],
    ["#####", "....#", "...#.", "...#.", "..#..", "..#..", ".#...", ".#..."],
    [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", "#...#", ".###."],
    [".###.", "#...#", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ];
  function drawAmount(digits) {
    const output = { width: 148, height: 19, data: new Uint8ClampedArray(148 * 19 * 4).fill(255) };
    let x = 24;
    for (let i = 0; i < digits.length; i++) {
      for (let y = 0; y < 8; y++)
        for (let column = 0; column < 5; column++)
          if (verifiedGlyphs[Number(digits[i])][y][column] === "#") {
            const index = ((y + 6) * output.width + x + column) * 4;
            output.data[index] = output.data[index + 1] = output.data[index + 2] = 0;
          }
      x += 6;
      const remaining = digits.length - i - 1;
      if (remaining > 0 && remaining % 3 === 0) {
        for (let y = 0; y < 3; y++) {
          const index = ((y + 11) * output.width + x) * 4;
          output.data[index] = output.data[index + 1] = output.data[index + 2] = 0;
        }
        x += 3;
      }
    }
    return output;
  }
  assert.deepEqual(Ocr.recognizeMesoDigits(drawAmount("2147483647")), { amount: 2147483647, confidence: 100 }, "digit fallback should support the full ten-digit signed 32-bit maximum");
  assert.equal(Ocr.recognizeMesoDigits(drawAmount("2147483648")), null, "digit fallback should reject values above the signed 32-bit maximum");

  const sample = PNG.sync.read(fs.readFileSync(path.join(__dirname, "fixtures/meso-clear-1135117.png"))),
    worker = await Tesseract.createWorker("eng", 1, {
      corePath: path.resolve(__dirname, "../assets/ocr"),
      langPath: path.resolve(__dirname, "../assets/ocr"),
      gzip: true,
    });
  const actual = await Ocr.readMesoAmount(sample, async (pixels) => {
    await worker.setParameters({
      tessedit_pageseg_mode: 7,
      tessedit_char_whitelist: "0123456789,.",
    });
    const input = new PNG({ width: pixels.width, height: pixels.height });
    input.data = Buffer.from(pixels.data);
    const { data } = await worker.recognize(PNG.sync.write(input));
    return { text: data.text, confidence: data.confidence };
  });
  assert.equal(actual?.amount, 1135117, "captured balance-box fixture should read 1,135,117 using bundled Tesseract");
  assert.ok(actual.confidence >= 40);

  const actualSingle = await Ocr.readMesoAmount(singleFive, async (pixels) => {
    await worker.setParameters({ tessedit_pageseg_mode: 7, tessedit_char_whitelist: "0123456789,." });
    const input = new PNG({ width: pixels.width, height: pixels.height });
    input.data = Buffer.from(pixels.data);
    const { data } = await worker.recognize(PNG.sync.write(input));
    return { text: data.text, confidence: data.confidence };
  });
  assert.equal(actualSingle?.amount, 5, "single clear 5 fixture should recover when bundled Tesseract drops the glyph");
  const actualNineteen = await Ocr.readMesoAmount(twoDigitNineteen, async (pixels) => {
    await worker.setParameters({ tessedit_pageseg_mode: 7, tessedit_char_whitelist: "0123456789,." });
    const input = new PNG({ width: pixels.width, height: pixels.height });
    input.data = Buffer.from(pixels.data);
    const { data } = await worker.recognize(PNG.sync.write(input));
    return { text: data.text, confidence: data.confidence };
  });
  assert.equal(actualNineteen?.amount, 19, "two-digit balance fixture should recover when bundled Tesseract drops both glyphs");
  await worker.terminate();

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
  console.log("Meso OCR: grouped amounts, bundled Tesseract fixture, confidence and adaptive consensus passed.");
})();
