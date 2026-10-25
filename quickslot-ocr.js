(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./quickslot-font"));
  else root.MapleQuickslotOcr = factory(root.MapleQuickslotFont);
})(typeof window === "undefined" ? globalThis : window, function (font) {
  "use strict";
  const templates = font.map((t) => ({
    digit: t.digit,
    data: Float32Array.from(t.mask, (c) => parseInt(c, 16) / 15),
  }));
  function recognize(image) {
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
        Math.max(r, g, b) - mn > 80
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
              if (w / n / h < 0.65 || w / n / h > 0.85 || h < 8) continue;
              let error = 0,
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
                margin = Math.min(margin, sorted[1][1] - sorted[0][1]);
              }
              if (!valid || /^0\d/.test(text)) continue;
              const score = { text, error: error / n, margin };
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
      return null;
    return {
      count: Number(best.text),
      confidence: Math.round((1 - best.error) * 100),
      error: best.error,
      margin: best.margin,
    };
  }
  return { recognize };
});
