const assert = require("node:assert/strict"),
  Reader = require("../reader");

(async () => {
  const added = [],
    session = {
      state: { paused: false, startAt: 1000 },
      addDropNotice(text, timestamp, confidence) {
        added.push({ text, timestamp, confidence });
        return true;
      },
    },
    reader = Reader.create({
      session,
      recognition: {},
      view: {},
      getCapture: () => ({ generation: 7, stream: {} }),
      localOcr: {
        async read() {
          return {
            dropNotice: {
              text: "",
              confidence: 50,
              candidates: [
                { text: "Mushroom Spore x1 (Other)", confidence: 99 },
                { text: "Mushroom Spore xl (Ete)", confidence: 8 },
              ],
            },
          };
        },
      },
    });

  assert.equal(
    reader.readDropNotice(
      { width: 2, height: 2, data: new Uint8ClampedArray(16) },
      1001,
    ),
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(added, [
    { text: "Mushroom Spore x1 (Etc)", timestamp: 1001, confidence: 8 },
  ], "a valid item format survives a weak OCR score while unrelated lines are rejected");
  console.log("Reader drop feed: structured low-confidence item candidates are accepted safely.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
