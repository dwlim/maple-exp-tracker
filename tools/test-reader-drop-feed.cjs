const assert = require("node:assert/strict"),
  Reader = require("../reader");

(async () => {
  const added = [];
  let reads = 0;
  const session = {
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
          reads++;
          const text = reads === 1
              ? "Mushroom Spore xl (Ete)"
              : "Lupin's Banana x1 earned. (Etc)";
          return {
            dropNotice: {
              text,
              confidence: 8,
              candidates: [{ text, confidence: 8 }],
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
  assert.equal(
    reader.readDropNotice(
      { width: 2, height: 2, data: new Uint8ClampedArray(16) },
      1201,
    ),
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.deepEqual(added, [
    { text: "Mushroom Spore x1 (Etc)", timestamp: 1001, confidence: 8 },
    { text: "Lupin's Banana x1 (Etc)", timestamp: 1201, confidence: 8 },
  ], "rapid structured item updates remain queued and normalize despite weak OCR scores");
  assert.equal(reads, 2, "both changed crops reach OCR instead of being overwritten");
  console.log("Reader drop feed: bounded FIFO keeps rapid low-confidence item updates.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
