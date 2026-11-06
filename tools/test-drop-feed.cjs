const assert = require("node:assert/strict"),
  Probe = require("../drop-feed-probe");
const parserCases = [
  {
    input:
      "You have gained mesos (+13)\nRed Potion x1 (Use)\nLevel up!",
    expected: ["Red Potion x1 (Use)"],
  },
  {
    input: "You have gained mesos (+5)\r\nYou have gained mesos (+5)",
    expected: [],
  },
  {
    input:
      "You have gained mesos (+A)\nYou have gained mes0s (+15)\nYou have gained mesos",
    expected: [],
  },
  {
    input: "You have gained mesos (+00042)",
    expected: [],
  },
  {
    input:
      "Garbage You have gained mesos\nYou have gained mesos garbage\nYou have gained mesos",
    expected: [],
  },
  {
    input:
      "Noise You received EXP (+42)\nYou received EXP (+42) noise\nYou received EXP ( + 00012 )",
    expected: [],
  },
  {
    input:
      "| You received EXP |\nBonus EXP for PARTY\nYou received EXP (+A)",
    expected: [],
  },
  {
    input:
      "You received EXP (+42)\nYou have gained EXP (+12)\nEXP +12\nMonster defeated",
    expected: [],
  },
  {
    input: "You received EXP (+A)\nYou received EXP ( + 00012 )",
    expected: [],
  },
  {
    input:
      "Bonus EXP for PARTY (+275)\nBonus EXP for party (+ 04 )\nBonus EXP for PARTY (+A)",
    expected: [],
  },
  {
    input:
      "Mushroom Spore x1 (Etc)\nLupin's Banana x1 earned. (Etc)\nRed Potion x2 (Use)\nBlue Snail Shell x10 (etc)",
    expected: [
      "Mushroom Spore x1 (Etc)",
      "Lupin's Banana x1 (Etc)",
      "Red Potion x2 (Use)",
      "Blue Snail Shell x10 (Etc)",
    ],
  },
  {
    input: "Mushroom Spore xl (Ete)\nRed Potion ×2 (Usc)\nBlue Snail Shell x1 (Other)",
    expected: ["Mushroom Spore x1 (Etc)", "Red Potion x2 (Use)"],
  },
  {
    input:
      "Mushroom Spore x? (Etc)\nMushroom Spore x0 (Etc)\nMushroom Spore x1 (Other)",
    expected: [],
  },
];
for (const test of parserCases)
  assert.deepEqual(Probe.parseNotices(test.input), test.expected);

const width = 256,
  height = 96,
  blank = (pulse = 0) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4,
          value = 20 + ((x * 3 + y * 5 + pulse * 7) % 28);
        data[i] = value;
        data[i + 1] = value + 8;
        data[i + 2] = value + 18;
        data[i + 3] = 255;
      }
    return { width, height, data };
  },
  addLine = (image, y, seed = 1) => {
    // Small bright glyph-like strokes with a stable baseline and word gaps.
    for (let char = 0; char < 16; char++) {
      const left = 28 + char * 12 + (seed % 2 === 0 ? 40 : 0),
        pattern = ((char + 1) * 13) % 31;
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 7; gx++)
          if (((pattern >> ((gx + gy * 2) % 5)) & 1) || gy === 0 || gy === 6) {
            const i = ((y + gy) * width + left + gx) * 4;
            image.data[i] = 255;
            image.data[i + 1] = 245;
            image.data[i + 2] = 80;
          }
    }
    return image;
  },
  probe = Probe.create(),
  sceneAnimation1 = blank(0),
  sceneAnimation2 = blank(1);
assert.deepEqual(probe.observe(sceneAnimation1), [], "First frame establishes row baseline");
assert.deepEqual(
  probe.observe(sceneAnimation2),
  [],
  "Unrelated changing scene pixels do not trigger pickup OCR",
);
const existing = addLine(blank(), 32, 1);
probe.reset();
assert.deepEqual(probe.observe(existing), []);
const oneFrameNoise = addLine(blank(), 50, 7);
assert.deepEqual(probe.observe(oneFrameNoise), [], "A new row waits for confirmation");
assert.deepEqual(probe.observe(blank()), [], "A one-frame bright artifact is ignored");
assert.deepEqual(probe.observe(addLine(blank(), 32, 1)), []);
const stacked = addLine(addLine(blank(), 14, 1), 32, 2);
assert.deepEqual(probe.observe(stacked), [], "New feed row is debounced for one frame");
assert.deepEqual(
  probe.observe(addLine(addLine(blank(1), 14, 1), 32, 2)),
  [{ y: 32, height: 7 }],
  "Only the stable newly added row is sent to OCR after the prior row shifts up",
);
assert.deepEqual(probe.observe(stacked), [], "Visible rows do not trigger repeatedly");
const repeatProbe = Probe.create();
repeatProbe.observe(addLine(blank(), 40, 3));
assert.deepEqual(repeatProbe.observe(blank()), [], "A single empty frame preserves the current stack baseline");
assert.deepEqual(repeatProbe.observe(blank(2)), [], "A second empty frame clears an expired stack");
assert.deepEqual(repeatProbe.observe(addLine(blank(), 40, 3)), [], "Repeated pickup text is debounced");
assert.deepEqual(
  repeatProbe.observe(addLine(blank(1), 40, 3)),
  [{ y: 40, height: 7 }],
  "The same pickup line can be detected again after the stack clears",
);
probe.reset();
assert.deepEqual(probe.observe(stacked), [], "Reset returns to baseline setup");

console.log("Drop feed probe: row-level novelty, stack shifts, animation rejection, debounce and conservative item normalization passed.");
