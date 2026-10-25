const path = require("node:path"),
  assert = require("node:assert/strict");
const { PNG } = require("pngjs"),
  { createWorker } = require("tesseract.js"),
  R = require("../hud-regions"),
  L = require("../level-ocr"),
  N = require("../local-ocr");
require("../hud-ocr");
(async () => {
  assert.equal(
    N.choose(
      [
        { text: "[94.65%]", confidence: 75 },
        { text: "[94.66%]", confidence: 80 },
      ],
      "exp",
    ),
    null,
    "Conflicting variants must reject",
  );
  assert.equal(
    N.choose(
      [
        { text: "[94.65%]", confidence: 0 },
        { text: "[94.65%]", confidence: 0 },
      ],
      "exp",
    ),
    null,
    "Low-confidence agreement alone must reject",
  );
  assert.equal(
    N.choose(
      [
        { text: "[194.65%]", confidence: 90 },
        { text: "[194.65%]", confidence: 90 },
      ],
      "exp",
    ),
    null,
    "Percentages over 100 must reject",
  );
  let unnecessaryCalls = 0;
  const fastOnly = N.createReader(async () => {
    unnecessaryCalls++;
    throw Error("Should not load model");
  });
  await fastOnly.read({
    nativeLevel: { data: { text: "68" } },
    nativeExp: { text: "[54.96%]" },
  });
  await fastOnly.read({
    nativeLevel: { data: { text: "68" } },
    nativeExp: { text: "1?[54.96%]" },
  });
  assert.equal(
    unnecessaryCalls,
    0,
    "Clear text and absent images must not load a worker",
  );
  assert.equal(
    N.choose(
      [
        { text: "[54.96%]", confidence: 90 },
        { text: "[54.96%]", confidence: 90 },
      ],
      "exp",
      { text: "1?[54.96%]" },
    ),
    null,
    "An uncertain full amount cannot become a percentage-only estimate",
  );
  const evidence = { text: "13?.680[51.24%]", requiredExp: 266682 },
    good = { text: "136.660[51.24%]", confidence: 84 },
    wrong = { text: "136.660[51.29%]", confidence: 78 };
  assert.equal(
    N.choose([good, wrong], "exp", evidence),
    null,
    "Math alone cannot turn one neural vote into acceptance",
  );
  assert.equal(
    N.choose([good, wrong, { ...good, confidence: 52 }], "exp", evidence).text,
    good.text,
    "Two matching variants plus EXP math recover the observed value",
  );
  assert.equal(
    N.choose(
      [good, { ...good }, { text: "136.650[51.24%]", confidence: 90 }],
      "exp",
      evidence,
    ),
    null,
    "Multiple math-consistent readings stay ambiguous",
  );
  const worker = await createWorker("eng", 1, {
    langPath: path.resolve("assets/ocr"),
    gzip: true,
    cacheMethod: "none",
  });
  const reader = N.createReader(async (pixels, kind) => {
    await worker.setParameters({
      tessedit_pageseg_mode: 7,
      tessedit_char_whitelist:
        kind === "level" ? "LV.0123456789" : "0123456789.[]% ",
    });
    const { data } = await worker.recognize(
      PNG.sync.write({
        width: pixels.width,
        height: pixels.height,
        data: Buffer.from(pixels.data),
      }),
    );
    if (process.env.OCR_TRACE)
      console.log(kind, JSON.stringify(data.text.trim()), data.confidence);
    return { text: data.text, confidence: data.confidence };
  });
  try {
    const downloaded = [
      ...require("./oct23-hud-fixtures.json"),
      ...require("./monitor-oct23-hud-fixtures.json"),
      ...require("./windowed-hud-fixtures.json"),
      ...require("./covered-exp-fixtures.json"),
      ...require("./fallback-exp-fixtures.json"),
    ].map((f) => ({
      ...f,
      patches: f.patches.map((p) => ({
        ...p,
        data: require("node:zlib").inflateSync(Buffer.from(p.rgba, "base64")),
      })),
    }));
    for (const f of [
      ...require("./stream-holdout-fixtures.json"),
      ...downloaded,
    ]) {
      const image = {
        width: f.width,
        height: f.height,
        data: new Uint8ClampedArray(f.width * f.height * 4),
      };
      for (const p of f.patches)
        for (let y = 0; y < p.height; y++)
          image.data.set(
            p.data.slice(y * p.width * 4, (y + 1) * p.width * 4),
            ((p.y + y) * f.width + p.x) * 4,
          );
      const rs = R.detect(image, L, MapleHudOcr);
      assert.ok(rs.level && rs.exp, f.name + " detection");
      const box = (r) => ({
          x: Math.round(r.x * f.width),
          y: Math.round(r.y * f.height),
          w: Math.round(r.w * f.width),
          h: Math.round(r.h * f.height),
        }),
        lb = box(rs.level),
        nativeLevel = L.recognize(R.crop(image, lb)),
        expImage = R.crop(image, box(rs.exp)),
        nativeExp = MapleHudOcr.recognize(expImage),
        levelImage = R.crop(image, {
          x: lb.x - lb.h * 3,
          y: lb.y - lb.h * 0.6,
          w: lb.w + lb.h * 3.4,
          h: lb.h * 2,
        }),
        recovered = await reader.read({
          requiredExp:
            /^\d{1,3}$/.test(nativeLevel.data.text) &&
            nativeLevel.data.confidence >= 35
              ? require("../session").required(Number(nativeLevel.data.text))
              : null,
          levelImage,
          expImage,
          nativeLevel,
          nativeExp,
        });
      if (f.exp.startsWith("["))
        assert.equal(
          recovered.level?.text || nativeLevel.data.text,
          f.level,
          f.name + " level",
        );
      assert.equal(
        recovered.exp?.text || nativeExp.text,
        f.exp,
        f.name + " EXP",
      );
      if(f.name.startsWith('full-exp-39-')) {
        const p=require('./test-helpers.cjs').pipeline({image,localOcr:{read:async()=>({})}}),frame={width:image.width,height:image.height,getContext:()=>({getImageData:()=>image})};
        await p.recognition.decodeFrame(frame);
        assert.ok(Array.isArray(frame._reading.expResult.rawReading.details),'An unsuccessful fallback preserves native glyph candidates');
        await p.reader.read(frame,1700000000000);
        assert.equal(p.session.state.samples.length,0,'Unresolved glyphs reject without crashing or saving a guessed value');
        assert.notDeepEqual(N.prepare(expImage,'exp-context','soft').data,N.prepare(expImage,'exp-context','binary').data,'The third pass must use different actual pixels');
      }
      if (f.name === "clam-71-full-exp-browser") {
        let variant = 0;
        const conflicting = N.createReader(async () => ({
          text: variant++ ? "152.225 2.00%" : "152.225 7.00%",
          confidence: 95,
        }));
        assert.equal(
          (
            await conflicting.read({
              levelImage,
              expImage,
              nativeLevel,
              nativeExp,
            })
          ).exp,
          null,
          "Conflicting full-context variants must reject",
        );
        const truncated = N.createReader(async () => ({
          text: "7.00%",
          confidence: 95,
        }));
        assert.equal(
          (
            await truncated.read({
              levelImage,
              expImage,
              nativeLevel,
              nativeExp,
            })
          ).exp,
          null,
          "An unreadable amount must never silently become a percentage-only estimate",
        );
      }
      const { pipeline } = require("./test-helpers.cjs"),
        Capture = require("../capture");
      const p = pipeline({ image, localOcr: reader }),
        frame = {
          width: f.width,
          height: f.height,
          getContext: () => ({ getImageData: () => image }),
        };
      await p.recognition.decodeFrame(frame);
      assert.equal(frame._reading.expResult.data.text, f.exp);
      const decodeOriginal = p.recognition.decodeFrame;
      p.recognition.decodeFrame = async () => {
        throw Error("Decoded reading must not run OCR twice");
      };
      await p.reader.read(frame, 1700000000000);
      if (
        !f.exp.startsWith("[") &&
        !recovered.level &&
        !/^\d{1,3}$/.test(nativeLevel.data.text)
      ) {
        assert.equal(
          p.session.state.samples.length,
          0,
          "Inferred level needs another distinct frame",
        );
        await p.reader.read(frame, 1700000000000);
        assert.equal(
          p.session.state.samples.length,
          0,
          "Duplicate frames cannot self-confirm",
        );
        await p.reader.read({ ...frame }, 1700000010000);
      }
      assert.equal(
        p.session.state.samples.length,
        1,
        p.node("#trackingStatus").textContent,
      );
      assert.equal(p.session.state.samples[0].level, Number(f.level));
      if (f.exp.startsWith("["))
        assert.equal(
          p.session.state.samples[0].pct,
          Number(f.exp.match(/[\d.]+/)[0]),
        );
      else {
        assert.equal(
          p.session.state.samples[0].exp,
          Number(f.exp.split("[")[0].replace(/\./g, "")),
        );
        assert.ok(!p.session.state.samples[0].estimated);
      }
      if(f.name.startsWith('full-exp-39-')) {
        const p=require('./test-helpers.cjs').pipeline({image,localOcr:{read:async()=>({})}}),frame={width:image.width,height:image.height,getContext:()=>({getImageData:()=>image})};
        await p.recognition.decodeFrame(frame);
        assert.ok(Array.isArray(frame._reading.expResult.rawReading.details),'An unsuccessful fallback preserves native glyph candidates');
        await p.reader.read(frame,1700000000000);
        assert.equal(p.session.state.samples.length,0,'Unresolved glyphs reject without crashing or saving a guessed value');
        assert.notDeepEqual(N.prepare(expImage,'exp-context','soft').data,N.prepare(expImage,'exp-context','binary').data,'The third pass must use different actual pixels');
      }
      if (f.name === "clam-71-full-exp-browser") {
        frame._reading = {
          ...frame._reading,
          expResult: { ...frame._reading.expResult, uncertain: true },
        };
        frame._pngBlob = { exactSnapshot: true };
        const diagnostic = require("../reader").create({
          session: p.session,
          recognition: p.recognition,
          view: p.view,
          debugTools: p.debugTools,
          getCapture: () => p.capture,
          debug: true,
        });
        await diagnostic.read(frame, 1700000020000);
        assert.equal(p.session.state.samples.length, 1);
        assert.equal(p.downloads.length, 1);
        assert.equal(p.downloads[0].frame._pngBlob, frame._pngBlob);
      } else {
        await p.reader.read(frame, 1700000020000);
        assert.equal(
          p.session.state.samples.length,
          2,
          "Fresh clear readings save immediately",
        );
      }
      if (["shiphtur-live-1", "shiphtur-fresh-64"].includes(f.name)) {
        const live = pipeline({ image, localOcr: reader });
        let clock = 1,
          captures = 0;
        const video = live.node("#sharePreview");
        Object.assign(video, {
          readyState: 2,
          videoWidth: f.width,
          videoHeight: f.height,
        });
        Object.defineProperty(video, "currentTime", { get: () => clock });
        const create = live.document.createElement;
        live.document.createElement = (kind) => {
          const canvas = create(kind);
          if (kind === "canvas") {
            const ctx = canvas.getContext("2d"),
              draw = ctx.drawImage;
            ctx.drawImage = (...args) => {
              if (args[0] === video) captures++;
              draw(...args);
            };
            canvas.getContext = () => ctx;
          }
          return canvas;
        };
        const track = { stop() {}, addEventListener() {} },
          stream = { getTracks: () => [track], getVideoTracks: () => [track] };
        live.capture = Capture.create({
          navigator: { mediaDevices: { getDisplayMedia: async () => stream } },
          video,
          document: live.document,
          session: live.session,
          recognition: live.recognition,
          reader: live.reader,
          view: live.view,
          debugTools: live.debugTools,
          now: () => 1700000100000 + Math.round(clock * 1000),
          timers: {
            setTimeout(fn, ms) {
              if (ms === 250) clock += 0.25;
              fn();
            },
            setInterval() {},
            clearInterval() {},
          },
        });
        await live.capture.connect();
        assert.equal(
          live.session.state.samples.length,
          1,
          live.node("#trackingStatus").textContent,
        );
        assert.equal(
          captures,
          f.name === "shiphtur-fresh-64" ? 2 : 1,
          "Only ambiguous inference takes another real capture",
        );
        live.capture.stop();
      }
      console.log(
        f.name +
          " passed real engine, single-frame decoding, conversion and guarded sample saving",
      );
    }
    let uncertain = 0;
    const optionalLevels = require("./neural-safety-fixtures.json");
    for (const f of optionalLevels) {
      const nativeLevel = L.recognize(f);
      if (!nativeLevel.data.text.includes("?")) continue;
      const r = await reader.read({
        levelImage: f,
        nativeLevel,
        nativeExp: { text: "" },
      });
      if (r.level && r.level.text !== f.expected)
        console.log(
          "NEURAL_CONFLICT",
          JSON.stringify({
            expected: f.expected,
            reading: r.level,
            native: nativeLevel,
          }),
        );
      if (r.level)
        assert.equal(
          r.level.text,
          f.expected,
          "Neural fallback must never turn a safely rejected level into a wrong accepted level",
        );
      uncertain++;
    }
    if (uncertain)
      console.log(
        "Neural safety checks passed for " +
          uncertain +
          " previously uncertain level variants",
      );
  } finally {
    await worker.terminate();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
