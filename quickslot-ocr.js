(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./quickslot-font"),
      require("./quickslot-small"),
    );
  else
    root.MapleQuickslotOcr = factory(
      root.MapleQuickslotFont,
      root.MapleQuickslotSmall,
    );
})(typeof window === "undefined" ? globalThis : window, function (font, Small) {
  "use strict";
  const templates = font
    .filter((t) => !t.smallCell)
    .map((t) => ({
      digit: t.digit,
      data: Float32Array.from(t.mask, (c) => parseInt(c, 16) / 15),
    }));
  function recognize(image, { digits = null, diagnostic = false } = {}) {
    if (image.height <= 15 && font.some((t) => t.smallCell))
      return Small.recognize(image, font);
    const { width, height, data } = image;
    if (
      width < 5 ||
      height < 8 ||
      width > 240 ||
      height > 80 ||
      data.length !== width * height * 4
    )
      return null;
    const gray = new Float32Array(width * height);
    let ink = 0;
    for (let p = 0; p < gray.length; p++) {
      const i = p * 4,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        mn = Math.min(r, g, b);
      gray[p] =
        Math.max(r, g, b) - mn > 80 || b + 8 < r || g + 8 < r
          ? 0
          : Math.max(0, Math.min(1, (mn - 45) / 130));
      if (gray[p] > 0.4) ink++;
    }
    if (ink < 8 || ink > gray.length * 0.9) return null;
    const choices = new Map(),
      vector = new Float32Array(234);
    for (let n = 1; n <= 5; n++)
      for (let l = -1; l <= 2; l++)
        for (let r = -1; r <= 2; r++)
          for (let t = -1; t <= 2; t++)
            for (let b = -1; b <= 2; b++) {
              const w = width - l - r,
                h = height - t - b;
              if (
                (digits && n !== digits) ||
                w / n / h < 0.65 ||
                w / n / h > 0.85 ||
                h < 8
              )
                continue;
              let error = 0,
                worstError = 0,
                margin = 1,
                text = "",
                valid = true;
              for (let k = 0; k < n; k++) {
                let p = 0;
                for (let y = 1; y < 19; y++)
                  for (let x = 1; x < 14; x++) {
                    const xx = Math.floor(l + ((k + (x + 0.5) / 15) * w) / n),
                      yy = Math.floor(t + ((y + 0.5) / 20) * h);
                    if (xx < 0 || xx >= width || yy < 0 || yy >= height) {
                      valid = false;
                      break;
                    }
                    vector[p++] = gray[yy * width + xx];
                  }
                if (!valid) break;
                const scores = new Map();
                for (const tp of templates) {
                  let e = 0,
                    p = 0;
                  for (let y = 1; y < 19; y++)
                    for (let x = 1; x < 14; x++)
                      e += Math.abs(vector[p++] - tp.data[y * 15 + x]);
                  e /= 234;
                  if (!scores.has(tp.digit) || e < scores.get(tp.digit))
                    scores.set(tp.digit, e);
                }
                const sorted = [...scores].sort((a, b) => a[1] - b[1]);
                text += sorted[0][0];
                error += sorted[0][1];
                worstError = Math.max(worstError, sorted[0][1]);
                margin = Math.min(margin, sorted[1][1] - sorted[0][1]);
              }
              if (!valid || /^0\d/.test(text)) continue;
              const score = { text, error: error / n, margin, worstError };
              if (!choices.has(text) || choices.get(text).error > score.error)
                choices.set(text, score);
            }
    const sorted = [...choices.values()].sort((a, b) => a.error - b.error),
      best = sorted[0];
    if (
      !best ||
      best.error > 0.08 ||
      best.margin < 0.045 ||
      (sorted[1] && sorted[1].error - best.error < 0.025)
    )
      return diagnostic && best
        ? { ...best, count: Number(best.text), accepted: false }
        : null;
    return {
      accepted: true,
      worstError: best.worstError,
      count: Number(best.text),
      confidence: Math.round((1 - best.error) * 100),
      error: best.error,
      margin: best.margin,
    };
  }
  // Quantities share their row with icon graphics. Do not accept an extra
  // weak glyph from the icon or truncate a plausible uncertain continuation.
  function recognizeSlot(image) {
    if (image.height <= 15) return Small.recognize(image, font);
    if (
      image.height < 8 ||
      image.width < 5 ||
      image.width > 240 ||
      image.height > 80
    )
      return null;
    const candidates = new Map(),
      widths = new Set(),
      uncertain = [];
    for (let n = 1; n <= 5; n++)
      for (const padding of [0, 2, 4]) {
        const width = Math.min(
          image.width,
          Math.round((image.height - 2) * 0.75 * n) + padding,
        );
        if (widths.has(n + ":" + width)) continue;
        widths.add(n + ":" + width);
        const data = new Uint8ClampedArray(width * image.height * 4);
        for (let y = 0; y < image.height; y++)
          data.set(
            image.data.slice(
              y * image.width * 4,
              (y * image.width + width) * 4,
            ),
            y * width * 4,
          );
        const r = recognize(
          { width, height: image.height, data },
          { digits: n, diagnostic: true },
        );
        if (r?.accepted && r.worstError <= 0.08)
          candidates.set(String(r.count), r);
        else if (r && r.worstError <= 0.16 && r.error <= 0.1) uncertain.push(n);
      }
    const sorted = [...candidates].sort((a, b) => b[0].length - a[0].length),
      best = sorted[0];
    if (
      !best ||
      uncertain.some((n) => n > best[0].length) ||
      sorted.some(([text]) => !best[0].startsWith(text))
    )
      return null;
    return best[1];
  }
  return { recognize, recognizeSlot };
});
