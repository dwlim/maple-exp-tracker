const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
require("../hud-ocr.js");
const fixtures = require("./hud-font-fixtures.json");
let exact = 0,
  heldOut = 0,
  rejected = 0;
for (const [i, f] of fixtures.entries()) {
  const r = MapleHudOcr.recognize(f),
    actual = r.text
      .replace(/\[|\]/g, "|")
      .replace(/\|$/, "")
      .replace(/,/g, "."),
    expected = f.expected.replace(/,/g, ".");
  if (actual === expected) {
    exact++;
    if (!f.training) heldOut++;
  } else {
    assert.ok(
      r.text.includes("?"),
      `Fixture ${i} silently misread ${expected}: ${r.text}`,
    );
    rejected++;
  }
}
const obs = MapleHudOcr.recognize(require("./obs-font-fixture.json"));
assert.equal(obs.text, "2.304[2.12%]");
assert.equal(
  MapleHudOcr.recognize(require("./current-font-fixture.json")).text,
  "14.909[13.74%]",
);
assert.equal(
  MapleHudOcr.recognize(require("./nine-font-fixture-bright.json")).text,
  "19.421[17.90%]",
);
assert.equal(
  MapleHudOcr.recognize(require("./eight-font-fixture.json")).text,
  "21.892[20.18%]",
);
assert.equal(
  MapleHudOcr.recognize(require("./review-font-fixture.json")).text,
  "22.781[21.00%]",
);
assert.equal(
  MapleHudOcr.recognize(require("./validation-font-fixture.json")).text,
  "26.322[24.26%]",
);
assert.equal(
  MapleHudOcr.recognize(require("./five-six-font-fixture.json")).text,
  "27.705[25.54%]",
);
assert.equal(
  MapleHudOcr.recognize(require("./six-font-fixture.json")).text,
  "29.242[26.96%]",
);
assert.equal(
  MapleHudOcr.recognize(require("./last-six-font-fixture.json")).text,
  "30.168[27.81%]",
);
const rejectedFrame = MapleHudOcr.recognize(
  require("./rejections-font-fixture.json"),
);
assert.equal(
  MapleHudOcr.resolveReading(
    MapleHudOcr.recognize(require("./buffered-font-fixture.json")),
    108480,
  ).text,
  "47.600[43.88%]",
);
assert.equal(rejectedFrame.text, "41.8?7[38.58%]");
assert.equal(
  MapleHudOcr.resolveReading(rejectedFrame, 108480).text,
  "41.857[38.58%]",
);
const tied = {
  text: "2.30?[2.12%]",
  details: [
    {
      char: "?",
      charIndex: 5,
      options: [
        { char: "3", error: 0.1 },
        { char: "4", error: 0.1 },
      ],
    },
  ],
};
assert.equal(
  MapleHudOcr.resolveReading(tied, 108480).text,
  tied.text,
  "Multiple consistent readings must stay rejected",
);
assert.equal(
  MapleHudOcr.resolveReading(rejectedFrame, NaN).text,
  rejectedFrame.text,
  "Unknown level must not resolve a reading",
);
// Changing crop padding must not change a digit into punctuation.
for (const [file, expected] of [
  ["obs-font-fixture.json", "2.304[2.12%]"],
  ["eight-font-fixture.json", "21.892[20.18%]"],
]) {
  const f = require("./" + file),
    height = f.height + 20,
    data = new Uint8Array(f.width * height * 4);
  data.set(f.data, f.width * 10 * 4);
  assert.equal(MapleHudOcr.recognize({ ...f, height, data }).text, expected);
}
// A cropped-off closing bracket must never be invented by the matcher.
const missing = { ...require("./eight-font-fixture.json") };
missing.data = missing.data.slice();
for (let y = 0; y < missing.height; y++)
  for (let x = 108; x < missing.width; x++)
    for (let channel = 0; channel < 3; channel++)
      missing.data[(y * missing.width + x) * 4 + channel] = 0;
assert.ok(!MapleHudOcr.recognize(missing).text.endsWith("]"));
assert.equal(
  MapleHudOcr.recognize(require("./nine-font-fixture.json")).text,
  "",
  "Faded frames must not generate readings",
);
assert.equal(
  MapleHudOcr.recognize({
    width: 100,
    height: 16,
    data: new Uint8Array(100 * 16 * 4),
  }).text,
  "",
);
const html = fs.readFileSync("index.html", "utf8");
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
  new vm.Script(match[1]);
const parseHudReading = require("../session").parseHudReading;
assert.equal(parseHudReading("LV. 31", obs.text).expToken, "2,304");
assert.equal(parseHudReading("LV. 31", obs.text).pctToken, "2.12");
const session = require("../session").create({
  levelOcr: require("../level-ocr"),
});
const uncertain = {
  rawText: obs.text,
  rawConfidence: 95,
  data: { text: obs.text, confidence: 95 },
  uncertain: true,
};
assert.equal(
  session.validate(
    { data: { text: "31", confidence: 95 }, expectedDigits: 2 },
    uncertain,
    2,
    1,
  ).valid,
  false,
  "Uncertain glyphs must block sample acceptance",
);
console.log(
  `${exact}/30 exact, ${rejected} safely rejected; ${heldOut}/${fixtures.filter((f) => !f.training).length} held-out frames exact; both OBS frames, blank crop, parser and syntax checks passed.`,
);
