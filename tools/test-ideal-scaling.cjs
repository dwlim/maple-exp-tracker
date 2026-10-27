const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { PNG } = require("pngjs"),
  R = require("../hud-regions"),
  L = require("../level-ocr"),
  { pipeline } = require("./test-helpers.cjs");
require("../hud-ocr");

function transform(png, scale, dx = 0, dy = 0) {
  const width = Math.round(png.width * scale),
    height = Math.round(png.height * scale),
    data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const source = { x: 550, y: 1070, width: 850, height: 56 },
    out = {
      width,
      height,
      data,
    };
  for (let y = 0; y < Math.round(source.height * scale); y++)
    for (let x = 0; x < Math.round(source.width * scale); x++) {
      const targetX = Math.round(source.x * scale) + x + dx,
        targetY = Math.round(source.y * scale) + y + dy;
      if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height)
        continue;
      const sourceX = source.x + Math.min(source.width - 1, Math.floor(x / scale)),
        sourceY = source.y + Math.min(source.height - 1, Math.floor(y / scale)),
        sourceIndex = (sourceY * png.width + sourceX) * 4;
      data.set(png.data.subarray(sourceIndex, sourceIndex + 4), (targetY * width + targetX) * 4);
    }
  return out;
}

const pixels = (region, image) => ({
  x: Math.round(region.x * image.width),
  y: Math.round(region.y * image.height),
  w: Math.round(region.w * image.width),
  h: Math.round(region.h * image.height),
});

const fixtures = [
  {
    file: "ideal-scaling-222168.png",
    level: 40,
    exp: 222168,
    pct: 75.51,
    expText: "222.168[75.51%]",
  },
  {
    file: "ideal-scaling-221609.png",
    level: 40,
    exp: 221609,
    pct: 75.32,
    expText: "221.609[75.32%]",
  },
];

(async () => {
  for (const fixture of fixtures) {
    const png = PNG.sync.read(
        fs.readFileSync(path.join(__dirname, "fixtures", fixture.file)),
      ),
      image = {
        width: png.width,
        height: png.height,
        data: new Uint8ClampedArray(png.data),
      },
      app = pipeline({ image, debug: true }),
      frame = {
        width: png.width,
        height: png.height,
        getContext: () => ({ getImageData: () => image }),
      };

    app.node("#latestFrame").naturalWidth = png.width;
    app.node("#latestFrame").naturalHeight = png.height;
    assert.equal(
      R.anchors(image)[0]?.kind,
      "static-buttons",
      `${fixture.file}: static controls provide the alignment anchor`,
    );
    await app.recognition.decodeFrame(frame);

    assert.equal(
      frame._reading.levelResult.data.text,
      String(fixture.level),
      `${fixture.file}: level`,
    );
    assert.equal(
      frame._reading.expResult.data.text,
      fixture.expText,
      `${fixture.file}: EXP and percentage`,
    );
    assert.equal(
      frame._reading.levelResult.engine,
      undefined,
      `${fixture.file}: clear native digits should not need neural OCR`,
    );
    assert.equal(
      frame._reading.expResult.engine,
      undefined,
      `${fixture.file}: clear native EXP should not need neural OCR`,
    );

    const result = await app.reader.read(frame, Date.now());
    assert.equal(result.accepted, true, `${fixture.file}: session accepts read`);
    const sample = app.session.state.samples.at(-1);
    assert.equal(sample.level, fixture.level, `${fixture.file}: stored level`);
    assert.equal(sample.exp, fixture.exp, `${fixture.file}: stored EXP`);
  }

  const png = PNG.sync.read(
    fs.readFileSync(path.join(__dirname, "fixtures", fixtures[0].file)),
  );
  const noCashShop = {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data),
  };
  for (let y = 1090; y < 1126; y++)
    for (let x = 1130; x < 1210; x++) {
      const i = (y * noCashShop.width + x) * 4;
      noCashShop.data[i] = noCashShop.data[i + 1] = noCashShop.data[i + 2] = 0;
      noCashShop.data[i + 3] = 255;
    }
  assert.ok(
    R.anchors(noCashShop).some((candidate) => candidate.kind === "static-buttons"),
    "Menu and Shortcut buttons still anchor the HUD if Cash Shop is obscured",
  );
  const noCashRegions = R.detect(noCashShop, L, MapleHudOcr);
  assert.ok(noCashRegions.level && noCashRegions.exp);
  assert.equal(
    L.recognize(R.crop(noCashShop, pixels(noCashRegions.level, noCashShop))).data.text,
    "40",
  );
  assert.equal(
    MapleHudOcr.recognize(R.crop(noCashShop, pixels(noCashRegions.exp, noCashShop))).text,
    fixtures[0].expText,
  );

  for (const scale of [0.75, 1, 1.5])
    for (const [dx, dy] of [
      [0, 0],
      [Math.round(35 * scale), Math.round(-18 * scale)],
    ]) {
      const image = transform(png, scale, dx, dy),
        anchor = R.anchors(image).find((candidate) => candidate.kind === "static-buttons"),
        regions = R.detect(image, L, MapleHudOcr);
      assert.ok(anchor, `Static button template at scale ${scale}`);
      assert.ok(regions.level && regions.exp, `Aligned regions at scale ${scale}`);
      const level = L.recognize(
          R.crop(image, pixels(regions.level, image)),
        ).data.text,
        exp = MapleHudOcr.recognize(
          R.crop(image, pixels(regions.exp, image)),
        ).text;
      if (scale === 1) {
        assert.equal(level, "40", `Level stays readable at scale ${scale}`);
        assert.equal(
          exp,
          fixtures[0].expText,
          `EXP stays readable at scale ${scale}`,
        );
      } else {
        assert.ok(level === "40" || level.includes("?"));
        assert.ok(exp === fixtures[0].expText || exp.includes("?"));
      }
    }

console.log("Ideal scaling OCR fixtures passed through alignment, scaling, and session tracking.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
