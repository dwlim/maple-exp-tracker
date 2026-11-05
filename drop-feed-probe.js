(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleDropFeedProbe = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  function create({ changedThreshold = 0.014, stableSamples = 2 } = {}) {
    let baseline = null,
      candidate = null,
      candidateCount = 0;
    function fingerprint(image) {
      if (!image?.data || image.data.length !== image.width * image.height * 4)
        return null;
      const columns = 64,
        rows = 24,
        result = new Uint8Array(columns * rows);
      for (let row = 0; row < rows; row++)
        for (let column = 0; column < columns; column++) {
          const x0 = Math.floor((column * image.width) / columns),
            x1 = Math.max(x0 + 1, Math.floor(((column + 1) * image.width) / columns)),
            y0 = Math.floor((row * image.height) / rows),
            y1 = Math.max(y0 + 1, Math.floor(((row + 1) * image.height) / rows));
          let luminance = 0,
            count = 0;
          for (let y = y0; y < Math.min(y1, image.height); y++)
            for (let x = x0; x < Math.min(x1, image.width); x++) {
              const i = (y * image.width + x) * 4;
              luminance +=
                0.2126 * image.data[i] +
                0.7152 * image.data[i + 1] +
                0.0722 * image.data[i + 2];
              count++;
            }
          result[row * columns + column] = count
            ? Math.round((luminance / count) / 16)
            : 0;
        }
      return result;
    }
    function distance(a, b) {
      if (!a || !b || a.length !== b.length) return 1;
      let changed = 0;
      for (let i = 0; i < a.length; i++)
        if (Math.abs(a[i] - b[i]) >= 2) changed++;
      return changed / a.length;
    }
    function observe(image) {
      const current = fingerprint(image);
      if (!current) return false;
      if (!baseline) {
        baseline = current;
        return false;
      }
      if (distance(current, baseline) < changedThreshold) {
        candidate = null;
        candidateCount = 0;
        return false;
      }
      if (candidate && distance(current, candidate) < changedThreshold / 2)
        candidateCount++;
      else {
        candidate = current;
        candidateCount = 1;
      }
      if (candidateCount < stableSamples) return false;
      baseline = current;
      candidate = null;
      candidateCount = 0;
      return true;
    }
    function reset() {
      baseline = candidate = null;
      candidateCount = 0;
    }
    return { observe, reset };
  }
  const ITEM_NOTICE_RE =
    /^([A-Za-z0-9][A-Za-z0-9'’&.,! -]{1,79}?)\s*[x×]\s*([0-9Il|Oo]{1,6})\s*\(([A-Za-z ]{2,8})\)$/i;
  const ITEM_CATEGORIES = [
    ["Etc", "etc"],
    ["Use", "use"],
    ["Equip", "equip"],
    ["Set Up", "setup"],
    ["Cash", "cash"],
    ["Deco", "deco"],
  ];
  function oneEditAway(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return edits + Number(i < a.length || j < b.length) <= 1;
  }
  function canonicalItemCategory(value) {
    const normalized = String(value || "").replace(/\s+/g, "").toLowerCase();
    return ITEM_CATEGORIES.find(([, key]) => oneEditAway(normalized, key))?.[0] || null;
  }
  function parseNotices(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) =>
        line
          .replace(/\s+/g, " ")
          .trim()
          .replace(/^[|·•;:,-]+\s*|\s*[|·•;:,-]+$/g, ""),
      )
      .map((line) => {
        const item = line.match(ITEM_NOTICE_RE);
        if (item) {
          const quantity = Number(item[2].replace(/[Il|]/g, "1").replace(/[Oo]/g, "0")),
            category = canonicalItemCategory(item[3]);
          if (quantity < 1 || !category) return null;
          return `${item[1].replace(/\s+/g, " ").trim()} x${quantity} (${category})`;
        }
        return null;
      })
      .filter(Boolean)
      .filter((line, index, all) => all.indexOf(line) === index);
  }
  function prepareOcrImage(image, threshold = 130, scale = 2) {
    if (!image?.data || image.data.length !== image.width * image.height * 4)
      return null;
    const width = image.width * scale,
      height = image.height * scale,
      data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const source =
            (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4,
          target = (y * width + x) * 4,
          value =
            (image.data[source] +
              image.data[source + 1] +
              image.data[source + 2]) /
              3 >
            threshold
              ? 255
              : 0;
        data[target] = data[target + 1] = data[target + 2] = value;
        data[target + 3] = 255;
      }
    return { width, height, data };
  }
  return { create, parseNotices, prepareOcrImage };
});
