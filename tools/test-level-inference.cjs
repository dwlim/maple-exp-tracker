const assert = require("node:assert/strict"),
  L = require("../level-ocr");
const required = require("../session").required;
const reading = (text) => ({
  data: { text, confidence: text.includes("?") ? 0 : 95 },
});
const infer = (text, e, p, pending = null, frame = 100000) =>
  L.resolveLevel(reading(text), e, p, required, pending, frame);
const first = infer("??", 770482, 78.82);
assert.equal(first.level, null);
assert.equal(first.pending.level, 56);
assert.equal(
  infer("??", 770482, 78.82, first.pending, 100000).level,
  null,
  "One frame cannot confirm itself",
);
const second = infer("5?", 770482, 78.82, first.pending, 110000);
assert.equal(second.level, 56);
assert.equal(infer("??", 770482, 78.82, second.pending, 120000).level, 56);
assert.equal(
  infer("??", 770482, 78.82, first.pending, 130000).level,
  null,
  "Expired evidence cannot confirm",
);
assert.equal(
  infer("??", 770482, 78.82, first.pending, 90000).level,
  null,
  "Older frames cannot confirm",
);
assert.equal(infer("56", 770482, 78.82).level, 56);
assert.equal(infer("58", 770482, 78.82).source, "conflict");
for (const [e, p] of [
  [NaN, 78.82],
  [770482, NaN],
  [0, 0],
  [1, 0.01],
  [770482, 100],
  [770482, 50],
]) {
  assert.equal(infer("??", e, p, first.pending, 110000).level, null);
  assert.equal(
    infer("??", e, p, first.pending, 110000).pending,
    null,
    "Invalid evidence resets confirmation",
  );
}
assert.equal(
  infer("56", 1, 0).level,
  56,
  "Clear HUD digits still work near zero percent",
);
assert.equal(
  L.resolveLevel(reading("??"), 500, 50, () => 1000, null, 1).level,
  null,
  "Multiple matching levels stay ambiguous",
);
assert.equal(
  L.checkContinuity(reading(String(second.level)), 31, null).accepted,
  false,
  "Inference cannot bypass session continuity",
);

// Direct module integration preserves independent evidence and duplicate-frame guards.
(async () => {
  const { pipeline, readingFrame } = require("./test-helpers.cjs"),
    p = pipeline();
  const f = readingFrame("??", "770.482[78.82%]", { levelConfidence: 0 });
  await p.reader.read(f, 1700000000000);
  assert.equal(p.session.state.samples.length, 0);
  await p.reader.read(f, 1700000000000);
  assert.equal(p.session.state.samples.length, 0);
  await p.reader.read(f, 1700000010000);
  assert.equal(p.session.state.samples[0].level, 56);
  assert.match(p.node("#ocrOutput").textContent, /level from EXP/);
  p.session.reset();
  const repaired = readingFrame("??", "770.482[78.82%]", {
    levelConfidence: 0,
    rawText: "770.48?[78.82%]",
    rawConfidence: 0,
  });
  await p.reader.read(repaired, 1700000020000);
  await p.reader.read(repaired, 1700000030000);
  assert.equal(
    p.session.state.samples.length,
    0,
    "Level-dependent repairs are not independent evidence",
  );
  console.log("Level inference and direct session/reader integration passed.");
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
