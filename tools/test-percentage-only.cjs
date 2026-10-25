const assert = require("node:assert/strict"),
  L = require("../level-ocr"),
  R = require("../hud-regions");
require("../hud-ocr");
const H = MapleHudOcr,
  required = require("../session").required;
for (const text of ["[78.82%]", "78.82%"]) {
  const result = H.percentageReading(text, required(61));
  assert.ok(result?.estimated);
  assert.equal(result.exp, Math.round(required(61) * 0.7882));
  assert.equal(result.pct, 78.82);
}
for (const text of [
  "[?8.82%]",
  "[78.82%",
  "78.82%]",
  "1.200.000[78.82%]",
  "101.00%",
  "-1.00%",
  "78%",
  "78.8%",
  "[EXP 78.82%]",
])
  assert.equal(H.percentageReading(text, required(61)), null, text);
assert.equal(
  H.percentageReading("[78.82%]", required(56)).exp,
  Math.round(required(56) * 0.7882),
  "The observed HUD format, not a numeric cutoff, selects percentage mode",
);
assert.equal(
  H.percentageReading("[0.34%]", required(61)).exp,
  Math.round(required(61) * 0.0034),
  "Valid percentage-only readings below one million must be supported",
);
assert.equal(H.percentageReading("[78.82%]", NaN), null);
assert.ok(H.percentageReading("[0.34%]", required(99)).exp > 1000000);
const nominal = H.percentageReading("[78.82%]", required(61));
assert.equal(
  H.percentageReading("[78.82%]", required(61), nominal.exp + 10).exp,
  nominal.exp + 10,
  "Switching formats must retain a previous value within the rounding interval",
);
assert.equal(
  H.percentageReading("[78.82%]", required(61), nominal.exp + 1000).exp,
  nominal.exp,
  "Values outside the rounding interval must not override a new reading",
);

// Construct percentage-only layouts from real, independently verified glyph pixels.
// The level recognizer is stubbed to 99 for detector isolation; these are not live captures.
const fixture = require("./hud-region-fixtures.json").find(
    (f) => f.level === "32",
  ),
  p = fixture.patches[1];
function assemble(bare = false, withAmount = false) {
  const width = fixture.width,
    height = fixture.height,
    data = new Uint8ClampedArray(width * height * 4);
  const patches = [fixture.patches[0]];
  if (withAmount) patches.push(p);
  else {
    const label = R.crop(p, { x: 0, y: 0, w: 58, h: p.height }),
      percentage = R.crop(p, { x: 96, y: 0, w: 75, h: p.height });
    if (bare)
      for (let i = 0; i < percentage.data.length; i += 4)
        if (
          percentage.data[i + 1] - percentage.data[i] > 12 &&
          percentage.data[i + 1] - percentage.data[i + 2] > 20
        )
          percentage.data.set([45, 52, 55, 255], i);
    patches.push(
      { ...label, x: p.x, y: p.y },
      { ...percentage, x: p.x + 59, y: p.y },
    );
  }
  for (const patch of patches)
    for (let y = 0; y < patch.height; y++)
      data.set(
        patch.data.slice(y * patch.width * 4, (y + 1) * patch.width * 4),
        ((patch.y + y) * width + patch.x) * 4,
      );
  return { width, height, data };
}
const highLevel = {
  ...L,
  recognize: (image) => {
    const r = L.recognize(image);
    return r.expectedDigits
      ? { ...r, data: { text: "99", confidence: 98 } }
      : r;
  },
};
const pixels = (r, f) => ({
  x: Math.round(r.x * f.width),
  y: Math.round(r.y * f.height),
  w: Math.round(r.w * f.width),
  h: Math.round(r.h * f.height),
});
for (const bare of [false, true]) {
  const f = assemble(bare),
    regions = R.detect(f, highLevel, H);
  assert.ok(
    regions.exp,
    `Percentage-only layout ${bare ? "bare" : "bracketed"} must be detected`,
  );
  const text = H.recognize(R.crop(f, pixels(regions.exp, f))).text;
  assert.ok(H.percentageReading(text, required(99)), text);
  const tracked = R.detect(f, highLevel, H, {
    ...regions,
    width: f.width,
    height: f.height,
  });
  assert.ok(tracked.exp);
  const rec = require("../recognition").create({
    document: {
      createElement() {
        throw Error("Cached crops must not allocate another canvas");
      },
    },
    state: { samples: [] },
    levelOcr: highLevel,
    hudOcr: H,
    hudRegions: R,
    required,
    getImage: () => ({}),
  });
  f._pixels = f;
  const result = rec.readExpGlyphs(regions.exp, f, 99);
  assert.equal(result.uncertain, false);
  assert.equal(result.percentageOnly.estimated, true);
  assert.equal(
    rec.readExpGlyphs(regions.exp, f, NaN).uncertain,
    true,
    "Percentage-only readings still require a readable level",
  );
}
const full = assemble(false, true),
  fullRegions = R.detect(full, highLevel, H),
  fullText = H.recognize(R.crop(full, pixels(fullRegions.exp, full))).text;
assert.equal(
  fullText,
  "412[0.34%]",
  "Full-amount readings must not be cropped into percentage-only estimates",
);
assert.ok(
  R.detect(assemble(false), L, H).exp,
  "A percentage-only layout must be locatable without the old hardcoded high-level gate",
);

(async () => {
  const { pipeline, readingFrame, packedFrame } = require("./test-helpers.cjs"),
    p = pipeline();
  const pctFrame = (level, pct) =>
    readingFrame(String(level), "[" + pct + "%]", {
      percentageOnly: H.percentageReading("[" + pct + "%]", required(level)),
    });
  let f = pctFrame(61, "78.82");
  await p.reader.read(f, 1700000000000);
  assert.equal(p.session.state.samples.length, 1);
  assert.equal(p.session.state.samples[0].estimated, true);
  assert.equal(
    p.session.state.samples[0].exp,
    Math.round(required(61) * 0.7882),
  );
  assert.match(p.node("#ocrOutput").textContent, /estimated from percentage/);
  await p.reader.read(f, 1700000001000);
  assert.equal(p.session.state.samples.length, 2);
  p.session.state.samples.splice(1);
  f._reading.levelResult.data = { text: "??", confidence: 0 };
  await p.reader.read(f, 1700000010000);
  assert.equal(
    p.session.state.samples.length,
    1,
    "Percentage alone cannot recover a missing level",
  );
  f = pctFrame(62, "0.92");
  const pending = await p.reader.read(f, 1700000020000);
  assert.equal(pending.accepted, false);
  assert.equal(pending.retry, true);
  const count = p.session.state.samples.length;
  await p.reader.read(f, 1700000020000);
  assert.equal(
    p.session.state.samples.length,
    count,
    "Same frame cannot confirm a level-up",
  );
  await p.reader.read(f, 1700000030000);
  assert.equal(p.session.state.samples.at(-1).level, 62);
  assert.equal(p.session.state.samples.at(-1).estimated, true);
  await p.reader.read(readingFrame("62", "12.345[0.92%]"), 1700000035000);
  assert.equal(p.session.state.samples.at(-1).exp, 12345);
  assert.ok(
    !p.session.state.samples.at(-1).estimated,
    "Exact amount mode resumes",
  );
  for (const real of [
    ...require("./hud-region-fixtures.json"),
    ...require("./downloaded-hud-fixtures.json"),
  ].filter((f) => f.percentageOnly)) {
    const image = packedFrame(real),
      actual = pipeline({ image }),
      frame = {
        width: image.width,
        height: image.height,
        _pixels: image,
        getContext: () => ({ getImageData: () => image }),
      };
    await actual.reader.read(frame, 1700000040000);
    const accepted = actual.session.state.samples[0];
    assert.equal(accepted.level, Number(real.level));
    assert.equal(accepted.pct, Number(real.exp.match(/[\d.]+/)[0]));
    assert.equal(accepted.exp, real.estimatedExp || 1114283);
    assert.equal(accepted.estimated, true);
    actual.session.reset();
    actual.session.state.level = 32;
    await actual.reader.read(frame, 1700000050000);
    assert.equal(actual.session.state.samples.length, 0);
    assert.match(actual.node("#rateHint").textContent, /saved level 32/);
    actual.session.reset();
    await actual.reader.read(frame, 1700000060000);
    await actual.reader.read(frame, 1700000070000);
    assert.equal(actual.session.state.samples.length, 2);
    actual.view.updateRateHint();
    assert.match(actual.node("#rateHint").textContent, /Estimated/);
    assert.equal(actual.session.state.samples[0].exp, accepted.exp);
  }
  console.log(
    "Percentage-only: conversion, cached crops, direct reader/session integration, level-ups, exact-mode restoration, session blockers and real frames passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

// Automatic covered-amount detection must find a unique complete bracket pair.
for (const fixture of require("./covered-exp-fixtures.json")) {
  const image = {
    width: fixture.width,
    height: fixture.height,
    data: new Uint8ClampedArray(fixture.width * fixture.height * 4),
  };
  for (const p of fixture.patches) {
    const data = require("node:zlib").inflateSync(
      Buffer.from(p.rgba, "base64"),
    );
    for (let y = 0; y < p.height; y++)
      image.data.set(
        data.subarray(y * p.width * 4, (y + 1) * p.width * 4),
        ((p.y + y) * image.width + p.x) * 4,
      );
  }
  const region = R.detect(image, L, H).exp,
    percent = R.percentageRegion(image, region);
  assert.ok(percent);
  assert.ok(
    percent.w <= region.w,
    "Automatic percentage region excludes occluding inventory fragments",
  );
  const b = {
    x: Math.round(region.x * image.width),
    y: Math.round(region.y * image.height),
    w: Math.round(region.w * image.width),
    h: Math.round(region.h * image.height),
  };
  assert.ok(
    /^\[[\d?.]+%\]$/.test(H.recognize(R.crop(image, b)).text),
    "Detector automatically selects percentage without a mode flag",
  );
  const blank = { ...image, data: new Uint8ClampedArray(image.data.length) };
  assert.equal(
    R.percentageRegion(blank, region),
    null,
    "Missing brackets must reject rather than fall back to covered text",
  );
}
