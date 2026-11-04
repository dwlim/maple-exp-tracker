const assert = require("node:assert/strict"),
  Probe = require("../drop-feed-probe");
const parserCases = [
  {
    input:
      "You have gained mesos (+13)\nYou have obtained Red Potion\nLevel up!",
    expected: ["You have gained mesos (+13)", "You have obtained Red Potion"],
  },
  {
    input: "You have gained mesos (+5)\r\nYou have gained mesos (+5)",
    expected: ["You have gained mesos (+5)"],
  },
  {
    input: "You have gained mesos (+A)\nYou have gained mes0s (+15)",
    expected: ["You have gained mesos"],
  },
  {
    input: "You have gained mesos (+00042)",
    expected: ["You have gained mesos (+00042)"],
  },
  {
    input:
      "You received EXP (+42)\nYou have gained EXP (+12)\nEXP +12\nMonster defeated",
    expected: ["You received EXP (+42)"],
  },
  {
    input: "You received EXP (+A)\nYou received EXP ( + 00012 )",
    expected: ["You received EXP (+00012)"],
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
assert.equal(probe.observe(frame(0)), false, "One changed frame is debounced");
assert.equal(probe.observe(frame(0)), true, "Stable changed region triggers once");
assert.equal(probe.observe(frame(0)), false, "Repeated frames do not retrigger");
assert.equal(probe.observe(frame(255)), false, "A new event starts a fresh debounce");
assert.equal(probe.observe(frame(255)), true, "A second stable change triggers");
probe.reset();
assert.equal(probe.observe(frame(0)), false, "Reset returns to baseline setup");

console.log("Drop feed probe: low-resolution change detection, debounce and conservative pickup-message normalization passed.");
