const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { PNG } = require("pngjs"),
  MapName = require("../map-name"),
  Reader = require("../reader");

function headerImage(variant) {
  const width = 128,
    height = 24,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const cell = (Math.floor(y / 2) * 64 + Math.floor(x / 2)) % 2,
        dark = cell === variant,
        index = (y * width + x) * 4;
      data[index] = dark ? 24 : 180;
      data[index + 1] = dark ? 32 : 205;
      data[index + 2] = dark ? 44 : 220;
      data[index + 3] = 255;
    }
  return { width, height, data };
}

function scaledFrameWithHeader(filename) {
  const header = PNG.sync.read(
      fs.readFileSync(path.join(__dirname, "fixtures", filename)),
    ),
    width = 1920,
    height = 1080,
    full = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < full.length; i += 4) {
    full[i] = full[i + 1] = full[i + 2] = 70;
    full[i + 3] = 255;
  }
  for (let y = 0; y < header.height; y++)
    full.set(
      header.data.subarray(y * header.width * 4, (y + 1) * header.width * 4),
      (44 + y) * width * 4,
    );
  const probeWidth = width / 2,
    probeHeight = height / 2,
    data = new Uint8ClampedArray(probeWidth * probeHeight * 4);
  for (let y = 0; y < probeHeight; y++)
    for (let x = 0; x < probeWidth; x++)
      data.set(
        full.subarray(((y * 2) * width + x * 2) * 4, ((y * 2) * width + x * 2) * 4 + 4),
        (y * probeWidth + x) * 4,
      );
  return { width: probeWidth, height: probeHeight, data };
}

const reader = Reader.create({
  session: { state: {} },
  recognition: {},
  view: {},
  getCapture: () => ({ generation: 1, stream: {} }),
  localOcr: {},
  mapNameApi: { cropHeaderText: (image) => image },
});
const currentMap = headerImage(0),
  nextMap = headerImage(1);
assert.equal(reader.observeMapProbe(currentMap), false, "the first probe establishes a baseline");
assert.equal(reader.observeMapProbe(currentMap), false, "an unchanged title does not schedule OCR");
assert.equal(reader.observeMapProbe(nextMap), false, "one changed probe is treated as transient");
assert.equal(reader.observeMapProbe(nextMap), true, "a stable second changed probe schedules one OCR read");
reader.resolveMapProbe(true);
assert.equal(reader.observeMapProbe(nextMap), false, "the accepted probe becomes the new baseline");

const noisyMap = headerImage(1);
noisyMap.data[0] = 179;
assert.equal(reader.observeMapProbe(noisyMap), false, "minor video noise does not retrigger a map scan");
reader.resetMapProbe();
assert.equal(reader.observeMapProbe(nextMap), false, "sharing restart starts a fresh visual baseline");

const retryReader = Reader.create({
  session: { state: {} },
  recognition: {},
  view: {},
  getCapture: () => ({ generation: 1, stream: {} }),
  localOcr: {},
  mapNameApi: { cropHeaderText: (image) => image },
});
retryReader.observeMapProbe(currentMap);
retryReader.observeMapProbe(nextMap);
assert.equal(retryReader.observeMapProbe(nextMap), true);
retryReader.resolveMapProbe(false);
assert.equal(retryReader.observeMapProbe(nextMap), false, "an unconfirmed OCR result can be retried");
assert.equal(retryReader.observeMapProbe(nextMap), true, "stable changed titles can trigger another bounded OCR attempt");
retryReader.resolveMapProbe(true);
assert.equal(retryReader.observeMapProbe(nextMap), false, "a confirmed OCR result commits the new baseline");

const fixtureReader = Reader.create({
  session: { state: {} },
  recognition: {},
  view: {},
  getCapture: () => ({ generation: 1, stream: {} }),
  localOcr: {},
});
const fixtureMapA = scaledFrameWithHeader("map-header-reference.png"),
  fixtureMapB = scaledFrameWithHeader("map-header-damp-forest.png");
assert.equal(fixtureReader.observeMapProbe(fixtureMapA), false);
assert.equal(fixtureReader.observeMapProbe(fixtureMapB), false);
assert.equal(
  fixtureReader.observeMapProbe(fixtureMapB),
  true,
  "a real half-resolution minimap title change passes the stable-change detector",
);

console.log("Map header probe: stable-change trigger, noise rejection and reset passed.");
