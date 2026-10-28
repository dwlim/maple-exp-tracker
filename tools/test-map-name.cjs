const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { createWorker } = require("tesseract.js");
const MapName = require("../map-name");
const LocalOcr = require("../local-ocr");
const Reader = require("../reader");

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

    // Regression for the compact, dimmed window capture: ensure the detector
    // finds its header and the OCR crop preserves the first map-name glyph.
    const darkHeader = PNG.sync.read(
        fs.readFileSync(path.join(__dirname, "fixtures/map-header-windowed-dark.png")),
      ),
      darkFrame = {
        width: 1924,
        height: 1126,
        data: new Uint8ClampedArray(1924 * 1126 * 4),
      };
    for (let i = 0; i < darkFrame.data.length; i += 4) darkFrame.data[i + 3] = 255;
    for (let y = 0; y < darkHeader.height; y++)
      darkFrame.data.set(
        darkHeader.data.subarray(y * darkHeader.width * 4, (y + 1) * darkHeader.width * 4),
        (48 + y) * darkFrame.width * 4 + 4 * 4,
      );
    const darkMapCrop = MapName.cropHeaderText(darkFrame);
    assert.ok(darkMapCrop, "find the compact minimap header in a dimmed game frame");
    const darkResult = await reader.read({ mapImage: darkMapCrop });
    assert.equal(
      darkResult.map?.text,
      "Kerning City Subway · Line 1 Area 1",
      "contrast recovery and crop alignment preserve the first glyph on compact HUDs",
    );

    let attempts = 0;
    const retrySession = {
        state: { paused: false, startAt: 1, mapName: "" },
        clearPending() {},
        setMesoStatus() {},
        validate() {
          return {
            valid: false,
            retry: false,
            continuity: {},
            levelResolution: {},
          };
        },
        setMapName(name) {
          this.state.mapName = name;
        },
      },
      capture = { generation: 1, stream: {} },
      retryReader = Reader.create({
        session: retrySession,
        recognition: { decodeFrame: async () => {} },
        view: {
          reading() {},
          renderReading() {},
          status() {},
          output() {},
        },
        debugTools: {},
        getCapture: () => capture,
        localOcr: {
          async read(input) {
            if (!input.mapImage) return {};
            attempts++;
            return attempts === 1
              ? { map: null }
              : { map: { text: "Kerning City Subway · Line 1 Area 1" } };
          },
        },
      }),
      sameFrame = {
        _pixels: darkFrame,
        _hudRegions: { exp: {} },
        _reading: { levelResult: {}, expResult: {} },
      },
      flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    await retryReader.read(sameFrame, 1700000000000);
    await flush();
    assert.equal(retrySession.state.mapName, "", "a failed OCR attempt leaves the map unset");
    await retryReader.read(sameFrame, 1700000010000);
    await flush();
    assert.equal(attempts, 2, "an unchanged header is retried after a transient OCR miss");
    assert.equal(
      retrySession.state.mapName,
      "Kerning City Subway · Line 1 Area 1",
      "the next successful map OCR updates the session state",
    );
  } finally {
    await worker.terminate();
  }
  console.log("Minimap map-name detection and OCR passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
