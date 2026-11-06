(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleDropFeedProbe = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  // This probe only describes likely message rows. OCR and strict item-line
  // validation stay downstream in reader.js.
  function create({
    columns = 64,
    minimumRowPixels = 3,
    minimumWidth = 0.12,
    maximumHeight = 16,
    mergeGap = 2,
    matchThreshold = 0.72,
  } = {}) {
    let previous = [],
      pending = [],
      emptySamples = 0,
      initialized = false;

    function textPixel(data, index) {
      const r = data[index],
        g = data[index + 1],
        b = data[index + 2],
        low = Math.min(r, g, b),
        high = Math.max(r, g, b);
      // Maple notices use bright white or yellow lettering. Neutral brightness
      // alone would also follow terrain highlights and character animations.
      return (
        (low >= 145 && high - low <= 58) ||
        (r >= 155 && g >= 125 && b <= 150 && r >= b * 1.3)
      );
    }

    function rows(image) {
      if (!image?.data || image.data.length !== image.width * image.height * 4)
        return [];
      const { width, height, data } = image,
        counts = new Uint16Array(height),
        mask = new Uint8Array(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4;
          if (textPixel(data, index)) {
            mask[y * width + x] = 1;
            counts[y]++;
          }
        }
      const threshold = Math.max(minimumRowPixels, Math.ceil(width * 0.01));
      const runs = [];
      let start = -1;
      for (let y = 0; y <= height; y++) {
        if (y < height && counts[y] >= threshold) {
          if (start < 0) start = y;
        } else if (start >= 0) {
          runs.push({ y: start, end: y });
          start = -1;
        }
      }
      const merged = [];
      for (const run of runs) {
        const prior = merged.at(-1);
        if (prior && run.y - prior.end <= mergeGap) prior.end = run.end;
        else merged.push({ ...run });
      }
      const bands = [];
      for (const run of merged) {
        const top = run.y,
          bottom = run.end;
        if (bottom - top < 2 || bottom - top > maximumHeight) continue;
        const verticalBins = 6,
          occupied = new Uint8Array(columns * verticalBins);
        let left = width,
          right = 0;
        for (let row = top; row < bottom; row++)
          for (let x = 0; x < width; x++)
            if (mask[row * width + x]) {
              left = Math.min(left, x);
              right = Math.max(right, x + 1);
              const column = Math.min(columns - 1, Math.floor((x * columns) / width)),
                vertical = Math.min(
                  verticalBins - 1,
                  Math.floor(((row - top) * verticalBins) / (bottom - top)),
                );
              occupied[vertical * columns + column] = 1;
            }
        if (right - left < width * minimumWidth) continue;
        bands.push({ y: top, height: bottom - top, signature: occupied });
      }
      return bands;
    }

    function similarity(a, b) {
      if (!a || !b || a.length !== b.length) return 0;
      // Allow small changes from video scaling, antialiasing and text fade.
      let best = 0,
        totalB = 0;
      const verticalBins = 6;
      for (const pixel of b) totalB += pixel;
      for (let shift = -2; shift <= 2; shift++) {
        let intersection = 0,
          totalA = 0;
        for (let row = 0; row < verticalBins; row++)
          for (let column = 0; column < columns; column++) {
            const left = row * columns + column,
              otherColumn = column + shift,
              right =
                otherColumn >= 0 && otherColumn < columns
                  ? row * columns + otherColumn
                  : -1;
            totalA += a[left];
            if (right >= 0) {
              intersection += a[left] && b[right] ? 1 : 0;
            }
          }
        const union = totalA + totalB - intersection;
        best = Math.max(best, union ? intersection / union : 1);
      }
      return best;
    }

    function unmatched(current, prior) {
      const used = new Set(), result = [];
      for (const band of current) {
        let match = -1,
          score = matchThreshold;
        for (let i = 0; i < prior.length; i++) {
          if (used.has(i)) continue;
          const candidate = similarity(band.signature, prior[i].signature);
          if (candidate >= score) {
            score = candidate;
            match = i;
          }
        }
        if (match < 0) result.push(band);
        else used.add(match);
      }
      return result;
    }

    function observe(image) {
      const current = rows(image);
      if (!current.length) {
        // Require two empty samples before allowing the same pickup text to
        // become new again. This bridges single-frame dim/occlusion glitches.
        if (++emptySamples >= 2) previous = [];
        pending = [];
        return [];
      }
      emptySamples = 0;
      if (!previous.length && !initialized) {
        previous = current;
        initialized = true;
        return [];
      }
      if (!previous.length) {
        const confirmed = pending.flatMap((candidate) => {
          const match = current.find((band) =>
            similarity(candidate.signature, band.signature) >= matchThreshold,
          );
          return match ? [match] : [];
        });
        if (confirmed.length) {
          previous = current;
          pending = [];
        } else pending = current;
        return confirmed.map(({ y, height }) => ({ y, height }));
      }
      const known = previous,
        added = unmatched(current, known),
        confirmed = pending.flatMap((candidate) => {
          const match = current.find((band) =>
            similarity(candidate.signature, band.signature) >= matchThreshold,
          );
          return match ? [match] : [];
        });
      if (confirmed.length) {
        pending = added.filter((band) =>
          !confirmed.some(
            (candidate) =>
              similarity(candidate.signature, band.signature) >= matchThreshold,
          ),
        );
        previous = current.filter((band) =>
          known.some(
            (line) => similarity(line.signature, band.signature) >= matchThreshold,
          ) ||
            confirmed.some(
              (line) => similarity(line.signature, band.signature) >= matchThreshold,
            ),
        );
      } else if (added.length) {
        pending = added;
        // Keep only previously recognized lines as baseline until a candidate
        // survives the second sample. This prevents animated one-frame glyphs
        // from being remembered as established message rows.
        previous = current.filter((band) =>
          known.some(
            (line) => similarity(band.signature, line.signature) >= matchThreshold,
          ),
        );
      } else {
        pending = [];
        previous = current;
      }
      return confirmed.map(({ y, height }) => ({ y, height }));
    }

    function reset() {
      previous = [];
      pending = [];
      emptySamples = 0;
      initialized = false;
    }
    return { observe, reset };
  }

  const ITEM_NOTICE_RE =
    /^([A-Za-z0-9][A-Za-z0-9'’&.,! -]{1,79}?)\s*[x×]\s*([0-9Il|Oo]{1,6})(?:\s+earned)?[.!]?\s*\(([A-Za-z ]{2,8})\)$/i;
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
            (image.data[source] + image.data[source + 1] + image.data[source + 2]) / 3 >
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
