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

  // The minimap logo anchors the two-line label. A larger pale-blue panel
  // farther right must not steal detection from the top-left minimap.
  const compactReference = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures/map-header-free-market-14.png")),
    ),
    compactFrame = {
      width: 1924,
      height: 1126,
      data: new Uint8ClampedArray(1924 * 1126 * 4),
    };
  for (let i = 0; i < compactFrame.data.length; i += 4) {
    compactFrame.data[i] = compactFrame.data[i + 1] = compactFrame.data[i + 2] = 70;
    compactFrame.data[i + 3] = 255;
  }
  for (let y = 0; y < compactReference.height; y++)
    compactFrame.data.set(
      compactReference.data.subarray(y * compactReference.width * 4, (y + 1) * compactReference.width * 4),
      (45 + y) * compactFrame.width * 4,
    );
  for (let y = 270; y < 335; y++)
    for (let x = 300; x < 640; x++) {
      const i = (y * compactFrame.width + x) * 4;
      compactFrame.data[i] = 152;
      compactFrame.data[i + 1] = 188;
      compactFrame.data[i + 2] = 204;
    }
  const anchoredHeader = MapName.findHeader(compactFrame),
    anchoredCrop = MapName.cropHeaderText(compactFrame, anchoredHeader);
  assert.ok(anchoredHeader, "find the minimap header when another blue panel is present");
  assert.ok(anchoredHeader.x < 10 && anchoredHeader.y < 60, "anchor to the top-left minimap logo");
  assert.ok(anchoredCrop.width > 80, "keep the full label after cropping past the logo");
  assert.equal(MapName.splitLabelLines(anchoredCrop).length, 2, "separate the street and map-name rows");
  const dampReference = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures/map-header-damp-forest.png")),
    ),
    dampFrame = {
      width: 1924,
      height: 1126,
      data: new Uint8ClampedArray(1924 * 1126 * 4),
    };
  for (let i = 0; i < dampFrame.data.length; i += 4) {
    dampFrame.data[i] = dampFrame.data[i + 1] = dampFrame.data[i + 2] = 70;
    dampFrame.data[i + 3] = 255;
  }
  for (let y = 0; y < dampReference.height; y++)
    dampFrame.data.set(
      dampReference.data.subarray(y * dampReference.width * 4, (y + 1) * dampReference.width * 4),
      (44 + y) * dampFrame.width * 4,
    );
  const dampCrop = MapName.cropHeaderText(dampFrame);
  assert.ok(dampCrop, "find the minimap header in the failed Damp Forest capture");
  assert.equal(
    MapName.parse("Victoria Road\nHenesys", 39)?.text,
    "Victoria Road · Henesys",
    "an exact map-list match is accepted below the normal confidence gate",
  );
  assert.equal(
    MapName.parse("Victoria Road\nHenesys", 70).text,
    "Victoria Road · Henesys",
  );
  const corrected = MapName.parse("Dungeon\nCamp Forest", 51);
  assert.equal(
    corrected.text,
    "Dungeon · Damp Forest",
    "the map lexicon corrects a one-character OCR error when the street line anchors the match",
  );
  assert.equal(corrected.canonicalized, true);
  assert.equal(
    MapName.parse("Hidden Street\nFee Marker i14", 41)?.text,
    "Hidden Street · Free Market <14>",
    "the exact street and numeric suffix disambiguate a three-character OCR error",
  );
  const ambiguous = MapName.parse("Dungeon\nCamp Frest", 51);
  assert.equal(
    ambiguous.text,
    "Dungeon · Camp Frest",
    "uncertain OCR remains raw instead of being guessed from the map list",
  );
  const exactLowConfidence = MapName.parse("Hidden Street\nFree Market 3", 35);
  assert.equal(
    exactLowConfidence?.text,
    "Hidden Street · Free Market <3>",
    "an exact, unique map-list match survives low aggregate OCR confidence",
  );
  assert.equal(exactLowConfidence.canonicalized, true);
  assert.equal(
    MapName.parse("Hidden Street\nFree Marker 3", 35),
    null,
    "low-confidence fuzzy map reads remain rejected",
  );
  assert.equal(
    MapName.parse("Maple Eoad\nShall Hunting Ground ll", 35),
    null,
    "two approximate lines below the confidence gate are not guessed",
  );
  assert.equal(
    MapName.parse("Maple Eoad\nShall Hunting Ground ll", 45)?.canonicalized,
    false,
    "uncertain Roman numerals are not inferred from ambiguous l/I glyphs",
  );

  const worker = await createWorker("eng", 1, {
    langPath: path.resolve("assets/ocr"),
    gzip: true,
    cacheMethod: "none",
  });
  const reader = LocalOcr.createReader(async (pixels, kind) => {
    assert.ok(kind === "map" || kind === "map-line");
    await worker.setParameters({
      tessedit_pageseg_mode: kind === "map" ? 6 : 7,
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

    const anchoredResult = await reader.read({ mapImage: anchoredCrop });
    assert.equal(
      anchoredResult.map?.text,
      "Hidden Street · Free Market <14>",
      "line-by-line OCR and exact numeric suffix recover a noisy map-name read",
    );

    const dampResult = await reader.read({ mapImage: dampCrop });
    assert.equal(
      dampResult.map?.text,
      "Dungeon · Damp Forest",
      "the failed Damp Forest HUD crop reads after restoring left padding past the emblem",
    );

    const freeMarketThree = PNG.sync.read(
      fs.readFileSync(
        path.join(__dirname, "fixtures/map-header-free-market-3-low-confidence.png"),
      ),
    );
    const freeMarketThreeResult = await reader.read({ mapImage: freeMarketThree });
    assert.equal(
      freeMarketThreeResult.map?.text,
      "Hidden Street · Free Market <3>",
      "the real OCR pipeline accepts the exact map-list match from a low-confidence HUD crop",
    );

    const freeMarketSeven = PNG.sync.read(
      fs.readFileSync(
        path.join(__dirname, "fixtures/map-header-free-market-7-fuzzy.png"),
      ),
    );
    const freeMarketSevenResult = await reader.read({ mapImage: freeMarketSeven });
    assert.equal(
      freeMarketSevenResult.map?.text,
      "Hidden Street · Free Market <7>",
      "an alternate scale recovers a fuzzy map line from the exact recognized street",
    );

    const dimmedFrame = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures/map-header-dimmed-panel.png")),
    );
    const dimmedHeader = MapName.findHeader(dimmedFrame);
    assert.ok(dimmedHeader, "find the merged minimap header on a dimmed frame");
    assert.equal(dimmedHeader.h, 64, "trim a merged minimap panel to the header band");
    const dimmedCrop = MapName.cropHeaderText(dimmedFrame, dimmedHeader);
    const dimmedResult = await reader.read({ mapImage: dimmedCrop });
    assert.equal(
      dimmedResult.map?.text,
      "Hidden Street · Free Market Entrance",
      "thresholded OCR recovers the map label in a dimmed capture",
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
      "Kerning City Subway · Line 1 <Area 1>",
      "contrast recovery and crop alignment preserve the first glyph on compact HUDs",
    );

    const skyConnectedFrame = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures/map-header-sky-connected.png")),
    );
    const skyConnectedHeader = MapName.findHeader(skyConnectedFrame);
    assert.ok(skyConnectedHeader, "find the title panel when blue sky connects to it");
    assert.ok(skyConnectedHeader.y < 20, "prefer the top-left title over the minimap image");
    const skyConnectedCrop = MapName.cropHeaderText(skyConnectedFrame, skyConnectedHeader);
    const skyConnectedResult = await reader.read({ mapImage: skyConnectedCrop });
    assert.ok(skyConnectedResult.map?.text, "read a map label when blue sky connects to its header");
    assert.equal(
      skyConnectedResult.map?.canonicalized,
      false,
      "keep ambiguous Roman numerals raw instead of choosing the wrong map variant",
    );

    const widerSkyFrame = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures/map-header-sky-connected-split-road.png")),
    );
    const widerSkyHeader = MapName.findHeader(widerSkyFrame);
    assert.ok(widerSkyHeader, "find a taller, wider title panel fused to the sky");
    assert.ok(widerSkyHeader.h <= 70, "trim a fused title panel to the title band");
    assert.equal(
      (await reader.read({ mapImage: MapName.cropHeaderText(widerSkyFrame, widerSkyHeader) })).map?.text,
      "Maple Road · A Split Road",
      "the wider title header is cropped from the top band rather than minimap image",
    );

    const romanAmbiguousFrame = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures/map-header-roman-ambiguous.png")),
    );
    const romanAmbiguousHeader = MapName.findHeader(romanAmbiguousFrame);
    assert.ok(romanAmbiguousHeader, "locate the title above blue sky on a busy frame");
    const romanAmbiguousResult = await reader.read({
      mapImage: MapName.cropHeaderText(romanAmbiguousFrame, romanAmbiguousHeader),
    });
    assert.ok(romanAmbiguousResult.map?.text, "preserve a readable raw label");
    assert.equal(
      romanAmbiguousResult.map?.canonicalized,
      false,
      "do not guess between similar Roman-numeral map names",
    );

    let attempts = 0;
    const mapFailures = [];
    const mapPreviews = [];
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
        debugTools: {
          async rejectFrame(frame, timestamp, reason) {
            mapFailures.push({ frame, timestamp, reason });
            return true;
          },
        },
        getCapture: () => capture,
        debug: true,
        onMapPreview: (pixels) => mapPreviews.push(pixels),
        localOcr: {
          async read(input) {
            if (!input.mapImage) return {};
            attempts++;
            return attempts <= 2
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
    await retryReader.read(sameFrame, 1700000000000, { report: false });
    await flush();
    assert.equal(retrySession.state.mapName, "", "a failed OCR attempt leaves the map unset");
    assert.equal(mapFailures.length, 1, "a failed map OCR reading requests a debug screenshot");
    assert.equal(mapFailures[0].reason, "map-name-not-found");
    assert.deepEqual(
      mapPreviews[0],
      MapName.prepare(darkMapCrop),
      "debug preview shows the exact enlarged and contrast-adjusted map OCR input",
    );
    await retryReader.read(sameFrame, 1700000010000, { report: false });
    await flush();
    assert.equal(attempts, 2, "an unchanged header is retried after a transient OCR miss");
    assert.equal(mapFailures.length, 1, "the same failed crop does not download repeatedly");
    await retryReader.read(sameFrame, 1700000020000, { report: false });
    await flush();
    assert.equal(attempts, 3, "map OCR keeps retrying after its one diagnostic download");
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
