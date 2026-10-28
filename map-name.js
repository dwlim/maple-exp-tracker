(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleMapName = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  // The minimap's title field is a distinctive pale blue. Search only the
  // upper-left portion of the shared game frame, where MapleStory places it.
  function findHeader(image) {
    if (!image?.data || !image.width || !image.height) return null;
    const width = image.width,
      height = image.height,
      scanWidth = Math.max(1, Math.floor(width * 0.45)),
      scanHeight = Math.max(1, Math.floor(height * 0.3)),
      seen = new Uint8Array(scanWidth * scanHeight),
      queue = new Int32Array(scanWidth * scanHeight),
      components = [];
    const isHeaderBlue = (x, y) => {
      const i = (y * width + x) * 4,
        r = image.data[i],
        g = image.data[i + 1],
        b = image.data[i + 2],
        total = r + g + b;
      return (
        total > 35 &&
        (g - r) / total >= 0.05 &&
        (b - g) / total >= 0.015
      );
    };
    for (let sy = 0; sy < scanHeight; sy++) {
      for (let sx = 0; sx < scanWidth; sx++) {
        const start = sy * scanWidth + sx;
        if (seen[start] || !isHeaderBlue(sx, sy)) continue;
        let head = 0,
          tail = 0,
          count = 0,
          left = sx,
          right = sx,
          top = sy,
          bottom = sy;
        queue[tail++] = start;
        seen[start] = 1;
        while (head < tail) {
          const cell = queue[head++],
            x = cell % scanWidth,
            y = Math.floor(cell / scanWidth);
          count++;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          const neighbors = [
            x > 0 ? cell - 1 : -1,
            x + 1 < scanWidth ? cell + 1 : -1,
            y > 0 ? cell - scanWidth : -1,
            y + 1 < scanHeight ? cell + scanWidth : -1,
          ];
          for (const neighbor of neighbors) {
            if (neighbor < 0 || seen[neighbor]) continue;
            const nx = neighbor % scanWidth,
              ny = Math.floor(neighbor / scanWidth);
            if (!isHeaderBlue(nx, ny)) continue;
            seen[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }
        const box = { x: left, y: top, w: right - left + 1, h: bottom - top + 1, count },
          imageCropLike =
            box.w > width * 0.7 &&
            box.h > height * 0.65 &&
            box.w / box.h > 2.5;
        if (imageCropLike) return box;
        if (
          box.x <= width * 0.22 &&
          box.y <= height * 0.25 &&
          box.w >= width * 0.045 &&
          box.w <= width * 0.3 &&
          box.h >= height * 0.025 &&
          box.h <= height * 0.16 &&
          box.w / box.h >= 2.0 &&
          count >= width * height * 0.001
        )
          components.push(box);
      }
    }
    components.sort((a, b) => b.count - a.count);
    return components[0] || null;
  }

  function cropHeaderText(image, box = findHeader(image)) {
    if (!box) return null;
    // The icon sits at the left of the minimap header. Keep both lines of
    // text and a small margin while excluding the icon and frame border.
    // The minimap logo is close to square and keeps roughly the same height
    // relative to the blue title band. On narrow/windowed captures, the blue
    // component can start well inside the logo, so a width-only offset leaves
    // part of it in the OCR input. Use the detected header height as a floor
    // for the icon exclusion while retaining the width-based offset on larger
    // layouts; this keeps the first map-name glyph intact.
    const compactHeader = box.w / image.width < 0.155,
      iconClearance = Math.ceil(box.h * 1.08),
      xOffset = Math.max(
        box.w * (compactHeader ? 0.16 : 0.2),
        iconClearance,
      ),
      x0 = Math.max(0, Math.floor(box.x + xOffset)),
      y0 = Math.max(0, Math.floor(box.y + box.h * 0.35)),
      x1 = Math.min(image.width, Math.ceil(box.x + box.w * 0.97)),
      y1 = Math.min(image.height, Math.ceil(box.y + box.h * 0.92)),
      w = x1 - x0,
      h = y1 - y0;
    if (w < 20 || h < 10) return null;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const source = ((y + y0) * image.width + x + x0) * 4,
          target = (y * w + x) * 4,
          gray = Math.round(
            image.data[source] * 0.299 +
              image.data[source + 1] * 0.587 +
              image.data[source + 2] * 0.114,
          );
        data[target] = data[target + 1] = data[target + 2] = gray;
        data[target + 3] = 255;
      }
    // Captures can be dimmed by overlays or Windows capture composition. Use
    // a robust percentile stretch so the pale lettering remains legible while
    // ignoring a few extreme pixels from the frame and text edges.
    const histogram = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) histogram[data[i]]++;
    const pixelCount = w * h;
    function percentile(target) {
      let total = 0;
      for (let value = 0; value < histogram.length; value++) {
        total += histogram[value];
        if (total >= target) return value;
      }
      return 255;
    }
    const low = percentile(pixelCount * 0.05),
      high = percentile(pixelCount * 0.95),
      range = high - low;
    if (compactHeader && range >= 24)
      for (let i = 0; i < data.length; i += 4) {
        const value = Math.max(0, Math.min(255, Math.round(((data[i] - low) * 255) / range)));
        data[i] = data[i + 1] = data[i + 2] = value;
      }
    return { width: w, height: h, data };
  }

  function prepare(image, scale = 4) {
    if (!image?.data || !image.width || !image.height) return null;
    const width = image.width * scale,
      height = image.height * scale,
      data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const sourceY = Math.floor(y / scale);
      for (let x = 0; x < width; x++) {
        const source = (sourceY * image.width + Math.floor(x / scale)) * 4,
          target = (y * width + x) * 4,
          gray = image.data[source];
        data[target] = data[target + 1] = data[target + 2] = gray;
        data[target + 3] = 255;
      }
    }
    return { width, height, data };
  }

  function parse(text, confidence) {
    if (!Number.isFinite(confidence) || confidence < 40) return null;
    const lines = String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= 3 && /[A-Za-z]{3}/.test(line))
      .slice(0, 2);
    if (!lines.length || lines.some((line) => line.length > 38)) return null;
    return { text: lines.join(" · "), confidence };
  }

  function hash(image) {
    if (!image?.data) return 0;
    let value = 2166136261;
    for (const byte of image.data) value = Math.imul(value ^ byte, 16777619);
    return value >>> 0;
  }

  return { findHeader, cropHeaderText, prepare, parse, hash };
});
