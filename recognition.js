(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleRecognition = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  function create({
    document,
    state,
    levelOcr,
    hudOcr,
    hudRegions,
    localOcr,
    required,
    getImage,
    debug = false,
    onExpPreview = () => {},
  }) {
    function readExpGlyphs(region, frame, level) {
      const pixels = cropLevelDigits(region, frame),
        raw = hudOcr.recognize(pixels),
        result = hudOcr.resolveReading(raw, required(level));
      if (debug) onExpPreview(pixels);
      const prior = state.samples.at(-1),
        percentageOnly = hudOcr.percentageReading(
          result.text,
          required(level),
          prior?.level === level ? prior.exp : null,
        );
      return {
        rawReading: raw,
        rawText: raw.text,
        rawConfidence: raw.confidence,
        data: { text: result.text, confidence: result.confidence },
        percentageOnly,
        uncertain:
          result.text.includes("?") ||
          (!percentageOnly && !/^\d[\d.]*\[\d+\.\d{2}%\]$/.test(result.text)),
      };
    }
    function cropLevelDigits(region, frame) {
      if (frame._pixels)
        return hudRegions.crop(frame._pixels, {
          x: Math.round(region.x * frame.width),
          y: Math.round(region.y * frame.height),
          w: Math.max(1, Math.round(region.w * frame.width)),
          h: Math.max(1, Math.round(region.h * frame.height)),
        });
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(region.w * frame.width));
      c.height = Math.max(1, Math.round(region.h * frame.height));
      const ctx = c.getContext("2d");
      ctx.drawImage(
        frame,
        Math.round(region.x * frame.width),
        Math.round(region.y * frame.height),
        c.width,
        c.height,
        0,
        0,
        c.width,
        c.height,
      );
      return ctx.getImageData(0, 0, c.width, c.height);
    }
    function currentRegions(image = getImage()) {
      if (state.calibration?.auto === false) return state.calibration;
      if (!image?.naturalWidth) return { level: null, exp: null };
      if (image._autoRegionSource === image.src) return image._autoRegions;
      const c = document.createElement("canvas");
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const regions = hudRegions.detect(
        ctx.getImageData(0, 0, c.width, c.height),
        levelOcr,
        hudOcr,
        image._trackedHud,
      );
      image._trackedHud = { ...regions, width: c.width, height: c.height };
      image._autoRegionSource = image.src;
      image._autoRegions = regions;
      return regions;
    }

    async function refineReadings(frame, regions, levelResult, expResult) {
      if (
        !localOcr ||
        (!levelResult.data.text.includes("?") && !expResult.uncertain)
      )
        return { levelResult, expResult };
      const r = regions.level,
        pixels = r ? (r.h * frame.height) / frame.width : 0,
        panel = r
          ? {
              x: Math.max(0, r.x - pixels * 3),
              y: Math.max(0, r.y - r.h * 0.6),
              w: r.w + pixels * 3.4,
              h: r.h * 2,
            }
          : null;
      const result = await localOcr.read({
        levelImage: panel ? cropLevelDigits(panel, frame) : null,
        expImage: cropLevelDigits(regions.exp, frame),
        requiredExp:
          /^\d{1,3}$/.test(levelResult.data.text) &&
          levelResult.data.confidence >= 35
            ? required(Number(levelResult.data.text))
            : null,
        nativeLevel: levelResult,
        nativeExp: {
          text: expResult.rawText,
          confidence: expResult.rawConfidence,
        },
      });
      if (result.level)
        levelResult = {
          ...levelResult,
          data: {
            text: result.level.text,
            confidence: result.level.confidence,
          },
          engine: "tesseract",
        };
      const raw = result.exp ||
          expResult.rawReading || {
            text: expResult.rawText,
            confidence: expResult.rawConfidence,
          },
        level = Number(levelResult.data.text),
        resolved = hudOcr.resolveReading(raw, required(level)),
        prior = state.samples.at(-1),
        percentageOnly = hudOcr.percentageReading(
          resolved.text,
          required(level),
          prior?.level === level ? prior.exp : null,
        );
      expResult = {
        rawReading: raw,
        rawText: raw.text,
        rawConfidence: raw.confidence,
        data: { text: resolved.text, confidence: resolved.confidence },
        percentageOnly,
        uncertain:
          resolved.text.includes("?") ||
          (!percentageOnly && !/^\d[\d.]*\[\d+\.\d{2}%\]$/.test(resolved.text)),
        engine: result.exp ? "tesseract" : expResult.engine,
      };
      return { levelResult, expResult };
    }
    async function decodeFrame(frame) {
      const pixels = frame
          .getContext("2d")
          .getImageData(0, 0, frame.width, frame.height),
        regions = {
          ...(state.calibration.auto === false
            ? state.calibration
            : hudRegions.detect(
                pixels,
                levelOcr,
                hudOcr,
                getImage()._trackedHud,
              )),
        };
      frame._pixels = pixels;
      frame._hudRegions = regions;
      getImage()._trackedHud = {
        ...regions,
        width: frame.width,
        height: frame.height,
      };
      if (!regions?.exp) return;
      const crop = regions.level
        ? cropLevelDigits(regions.level, frame)
        : { width: 1, height: 1, data: new Uint8ClampedArray(4) };
      const levelResult = levelOcr.recognize(crop),
        expResult = readExpGlyphs(
          regions.exp,
          frame,
          Number(levelResult.data.text),
        );
      frame._reading = await refineReadings(
        frame,
        regions,
        levelResult,
        expResult,
      );
    }

    function reset() {
      const image = getImage();
      if (image) {
        image._trackedHud = null;
        image._autoRegionSource = null;
      }
    }
    return {
      readExpGlyphs,
      cropLevelDigits,
      currentRegions,
      refineReadings,
      decodeFrame,
      reset,
    };
  }
  return { create };
});
