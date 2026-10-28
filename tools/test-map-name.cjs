const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { createWorker } = require("tesseract.js");
const MapName = require("../map-name");
const LocalOcr = require("../local-ocr");

(async () => {
  const reference = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures/map-header-reference.png")),
    ),
    frame = {
      width: 1920,
      height: 1080,
      data: new Uint8ClampedArray(1920 * 1080 * 4),
    };
  for (let i = 0; i < frame.data.length; i += 4) frame.data[i + 3] = 255;
  for (let y = 0; y < reference.height; y++)
    frame.data.set(
      reference.data.subarray(y * reference.width * 4, (y + 1) * reference.width * 4),
      (y + 20) * frame.width * 4,
    );

  const header = MapName.findHeader(frame),
    mapCrop = MapName.cropHeaderText(frame, header);
  assert.ok(header, "find the blue minimap header in a full game frame");
  assert.ok(mapCrop, "crop the map-name text area, excluding the icon");
  assert.equal(MapName.parse("Victoria Road\nHenesys", 39), null);
  assert.equal(
    MapName.parse("Victoria Road\nHenesys", 70).text,
    "Victoria Road · Henesys",
  );

  const worker = await createWorker("eng", 1, {
    langPath: path.resolve("assets/ocr"),
    gzip: true,
    cacheMethod: "none",
  });
  const reader = LocalOcr.createReader(async (pixels, kind) => {
    assert.equal(kind, "map");
    await worker.setParameters({
      tessedit_pageseg_mode: 6,
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-'(),.0123456789 ",
    });
    const result = await worker.recognize(
      PNG.sync.write({
        width: pixels.width,
        height: pixels.height,
        data: Buffer.from(pixels.data),
      }),
    );
    return { text: result.data.text, confidence: result.data.confidence };
  });
  try {
    const result = await reader.read({ mapImage: mapCrop });
    assert.equal(
      result.map?.text,
      "Victoria Road · Henesys",
      "bundled OCR reads both lines of the minimap label",
    );
  } finally {
    await worker.terminate();
  }
  console.log("Minimap map-name detection and OCR passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
