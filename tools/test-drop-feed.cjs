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

const probe = Probe.create(),
  frame = (color) => {
    const width = 256,
      height = 96,
      data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = 255;
    }
    for (let y = 30; y < 55; y++)
      for (let x = 40; x < 170; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = color;
      }
    return { width, height, data };
  };
assert.equal(probe.observe(frame(255)), false, "First frame establishes baseline");
assert.equal(probe.observe(frame(0)), true, "First meaningful change triggers OCR");
assert.equal(probe.observe(frame(0)), false, "Repeated frames do not retrigger");
assert.equal(probe.observe(frame(255)), true, "A second meaningful change triggers immediately");
probe.reset();
assert.equal(probe.observe(frame(0)), false, "Reset returns to baseline setup");
const debouncedProbe = Probe.create({ stableSamples: 2 });
assert.equal(debouncedProbe.observe(frame(255)), false);
assert.equal(debouncedProbe.observe(frame(0)), false, "Optional debounce remains available");
assert.equal(debouncedProbe.observe(frame(0)), true);

console.log("Drop feed probe: immediate change detection, optional debounce and conservative pickup-message normalization passed.");
