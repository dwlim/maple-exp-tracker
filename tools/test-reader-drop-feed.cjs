const assert = require("node:assert/strict"),
  Reader = require("../reader");

(async () => {
  const added = [],
    failedCrops = [];
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
      debug: true,
      debugTools: {
        async rejectImage(image, timestamp, reason) {
          failedCrops.push({ image, timestamp, reason });
          return true;
        },
      },
      getCapture: () => ({ generation: 7, stream: {} }),
      localOcr: {
        async read() {
          reads++;
          const text = reads === 1
              ? "Mushroom Spore xl (Ete)"
              : reads === 2
                ? "Lupin's Banana x1 earned. (Etc)"
                : reads === 3
                  ? "You received EXP (+5)"
                  : "unclear pickup text";
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
  reader.readDropNotice(
    { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    1401,
  );
  reader.readDropNotice(
    { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    1601,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.deepEqual(added, [
    { text: "Mushroom Spore x1 (Etc)", timestamp: 1001, confidence: 8 },
    { text: "Lupin's Banana x1 (Etc)", timestamp: 1201, confidence: 8 },
  ], "rapid structured item updates remain queued and normalize despite weak OCR scores");
  assert.equal(reads, 4, "all changed crops reach OCR instead of being overwritten");
  assert.equal(failedCrops.length, 1, "an unreadable item crop is saved for debugging");
  assert.equal(failedCrops[0].reason, "no-item-line");
  assert.equal(failedCrops[0].image.width, 2);
  console.log("Reader drop feed: rapid items queue, ignored EXP stays quiet, and unreadable crops are captured.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
