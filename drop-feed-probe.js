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
    /^([A-Za-z0-9][A-Za-z0-9'&., -]{1,79}?)\s+x\s*(\d{1,6})\s*\((Etc|Use|Equip|Set\s*Up|Setup|Cash|Deco)\)$/i;
  function parseNotices(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => {
        if (line.length < 8 || line.length > 180) return false;
        if (/\bEXP\b/i.test(line))
          return /(?:\byou received\s+EXP|\bbonus\s+EXP\s+for\s+PARTY)\s*\(\s*\+\s*\d{1,9}\s*\)/i.test(
            line,
          );
        const item = line.match(ITEM_NOTICE_RE);
        if (item) return Number(item[2]) > 0;
        return /\b(?:you have (?:gained|obtained|received|picked up)|mesos?\s*\(\s*\+)/i.test(
          line,
        );
      })
      .map((line) => {
        const exp = line.match(
          /\byou received\s+EXP\s*\(\s*\+\s*(\d{1,9})\s*\)|\bbonus\s+EXP\s+for\s+PARTY\s*\(\s*\+\s*(\d{1,9})\s*\)/i,
        );
        if (exp)
          return exp[1]
            ? "You received EXP (+" + exp[1] + ")"
            : "Bonus EXP for PARTY (+" + exp[2] + ")";
        const item = line.match(ITEM_NOTICE_RE);
        if (item) {
          const category = item[3].replace(/\s+/g, " ").toLocaleLowerCase("en-US"),
            canonicalCategory = {
              etc: "Etc",
              use: "Use",
              equip: "Equip",
              "set up": "Set Up",
              setup: "Set Up",
              cash: "Cash",
              deco: "Deco",
            }[category];
          return `${item[1].replace(/\s+/g, " ").trim()} x${Number(item[2])} (${canonicalCategory})`;
        }
        // The mesos toast has a fixed grammar. Normalize that phrase and keep
        // an amount only when OCR returned the complete (+digits) suffix.
        const mesos = line.match(
          /\byou have (gained|obtained|received|picked up)\s+mes[o0]s?\b/i,
        );
        if (!mesos) return line;
        const cleanSpelling = /\bmesos\b/i.test(line),
          amount = cleanSpelling
            ? line.match(/\bmesos\s*\(\s*\+\s*(\d{1,9})\s*\)/i)
            : null;
        return (
          "You have " +
          mesos[1].toLocaleLowerCase("en-US") +
          " mesos" +
          (amount ? " (+" + amount[1] + ")" : "")
        );
      })
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
