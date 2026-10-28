(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./map-name-data"));
  else root.MapleMapName = factory(root.MapleMapNames || []);
})(typeof window === "undefined" ? globalThis : window, function (mapNames) {
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
          // The minimap is pinned to the top-left. Pale-blue shop dialogs
          // elsewhere in the frame can be larger, so color/area alone must
          // not outrank this stable screen anchor.
          box.x <= width * 0.08 &&
          box.y <= height * 0.12 &&
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
    components.sort((a, b) =>
      a.x + a.y * 0.5 - (b.x + b.y * 0.5) || b.count - a.count,
    );
    return components[0] || null;
  }

  function cropHeaderText(image, box = findHeader(image)) {
    if (!box) return null;
    const headerWidthRatio = box.w / image.width,
      compactHeader = headerWidthRatio < 0.155,
      // Use the square emblem to locate the text, but leave some left padding:
      // at small HUD sizes the first glyph can start immediately after it.
      xOffset = box.h * 0.35,
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
    // Mask the emblem through its expected right edge while retaining the
    // original x position of the first text glyph.
    const logoSliver = Math.max(
      0,
      Math.min(Math.floor(w * 0.48), Math.ceil(box.h * 0.65 - xOffset)),
    );
    if (logoSliver > 0 && w > logoSliver + 1) {
      const background = [];
      for (let x = logoSliver; x < Math.min(w, logoSliver + 7); x++)
        for (let y = 0; y < h; y++) {
          const value = data[(y * w + x) * 4];
          if (value >= 85 && value <= 230) background.push(value);
        }
      background.sort((a, b) => a - b);
      const fill = background.length ? background[Math.floor(background.length / 2)] : 160;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < logoSliver; x++) {
          const i = (y * w + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = fill;
        }
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

  function splitLabelLines(image) {
    if (!image?.data || image.width < 20 || image.height < 12) return [];
    const activeRows = [];
    for (let y = 0; y < image.height; y++) {
      const values = [];
      for (let x = 0; x < image.width; x++)
        values.push(image.data[(y * image.width + x) * 4]);
      values.sort((a, b) => a - b);
      const median = values[Math.floor(values.length / 2)],
        ink = values.filter((value) => Math.abs(value - median) >= 24).length;
      activeRows.push(ink >= Math.max(3, Math.floor(image.width * 0.035)));
    }
    const runs = [];
    for (let y = 0; y < activeRows.length; y++) {
      if (!activeRows[y]) continue;
      let end = y + 1;
      while (end < activeRows.length && activeRows[end]) end++;
      if (end - y >= 3) runs.push([Math.max(0, y - 1), Math.min(image.height, end + 1)]);
      y = end - 1;
    }
    if (runs.length < 2) return [];
    const rows = runs.slice(0, 2);
    return rows.map(([top, bottom]) => {
      const data = new Uint8ClampedArray(image.width * (bottom - top) * 4);
      data.set(image.data.subarray(top * image.width * 4, bottom * image.width * 4));
      return { width: image.width, height: bottom - top, data };
    });
  }

  function normalizeName(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function editDistance(left, right) {
    const a = normalizeName(left),
      b = normalizeName(right);
    if (!a || !b) return Infinity;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i),
      current = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      for (let j = 1; j <= b.length; j++)
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      [previous, current] = [current, previous];
    }
    return previous[b.length];
  }

  function canonicalMap(lines) {
    if (lines.length !== 2 || !Array.isArray(mapNames)) return null;
    const matches = [];
    for (const [street, name] of mapNames) {
      const streetDistance = editDistance(lines[0], street),
        nameDistance = editDistance(lines[1], name),
        normalizedName = normalizeName(name),
        observedName = normalizeName(lines[1]),
        numericSuffix = normalizedName.match(/\d+$/)?.[0],
        hasExactNumericSuffix =
          !!numericSuffix && observedName.endsWith(numericSuffix),
        maxNameDistance =
          streetDistance === 0 && hasExactNumericSuffix
            ? 3
            : Math.min(2, Math.max(1, Math.floor(normalizedName.length * 0.08)));
      // Require at least one exact line as a strong anchor. This lets the
      // known street disambiguate a small typo in the map name, without
      // turning unrelated or ambiguous OCR into a guessed map.
      if (
        streetDistance <= 1 &&
        nameDistance <= maxNameDistance &&
        (streetDistance === 0 || nameDistance === 0)
      )
        matches.push({ street, name, score: streetDistance + nameDistance });
    }
    matches.sort((a, b) => a.score - b.score);
    if (!matches.length || (matches[1] && matches[1].score === matches[0].score)) return null;
    return matches[0];
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
    const canonical = canonicalMap(lines);
    return {
      text: canonical ? `${canonical.street} · ${canonical.name}` : lines.join(" · "),
      confidence,
      canonicalized: !!canonical,
    };
  }

  function hash(image) {
    if (!image?.data) return 0;
    let value = 2166136261;
    for (const byte of image.data) value = Math.imul(value ^ byte, 16777619);
    return value >>> 0;
  }

  return { findHeader, cropHeaderText, splitLabelLines, prepare, parse, hash, canonicalMap };
});
