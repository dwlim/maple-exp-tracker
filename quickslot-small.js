(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleQuickslotSmall = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const models = new WeakMap();
  function model(font) {
    if (models.has(font)) return models.get(font);
    const native = font.filter((t) => t.smallCell),
      m = {
        palette: native[0]?.palette,
        templates: native.map((t) => ({
          ...t,
          mask: t.smallMask,
          shape: Float32Array.from(t.smallCell, (c) => parseInt(c, 16) / 15),
        })),
      };
    models.set(font, m);
    return m;
  }
  function value(r, g, b, p) {
    return p < 0
      ? 0
      : Math.max(
          0,
          1 -
            Math.max(
              Math.abs(r - (p >> 16)),
              Math.abs(g - ((p >> 8) & 255)),
              Math.abs(b - (p & 255)),
            ) /
              48,
        );
  }
  // The native font advances eight pixels per digit and five for 1.
  // Match grayscale only on stable glyph/outline pixels. The icon is not evidence.
  function cell(image, cursor, top, digit) {
    const width = digit === "1" ? 3 : 7,
      shape = [];
    for (let y = 1; y <= 9; y++)
      for (let x = 2; x < width + 2; x++) {
        const xx = cursor + x,
          yy = top + y;
        if (xx < 0 || xx >= image.width || yy < 0 || yy >= image.height)
          return null;
        const i = (yy * image.width + xx) * 4;
        shape.push(
          (image.data[i] * 0.299 +
            image.data[i + 1] * 0.587 +
            image.data[i + 2] * 0.114) /
            255,
        );
      }
    return shape;
  }
  function hasText(image, palette, cursor, top, end = image.width) {
    let first = false,
      last = false,
      ink = 0,
      rows = 0;
    for (let y = 1; y <= 9; y++) {
      let row = 0;
      for (let x = 2; x < 9 && cursor + x < Math.min(image.width, end); x++) {
        const i = ((top + y) * image.width + cursor + x) * 4;
        if (
          value(
            image.data[i],
            image.data[i + 1],
            image.data[i + 2],
            palette[Math.floor(((y + 0.5) / 12) * 20)],
          ) > 0.5
        ) {
          ink++;
          row++;
          if (y <= 2) first = true;
          if (y >= 8) last = true;
        }
      }
      if (row) rows++;
    }
    return first && last && ink >= 6 && rows >= 6;
  }
  function recognize(image, font) {
    const { palette, templates } = model(font);
    if (
      !palette ||
      image.height < 12 ||
      image.height > 15 ||
      image.data.length !== image.width * image.height * 4
    )
      return null;
    const readings = new Map();
    for (let top = 0; top <= image.height - 12; top++)
      for (let left = 0; left <= 4; left++) {
        if (hasText(image, palette, 0, top, left + 2)) continue;
        let cursor = left,
          text = "",
          error = 0,
          confidence = 100,
          valid = true;
        for (let n = 0; n < 6; n++) {
          if (!hasText(image, palette, cursor, top)) break;
          if (n === 5) {
            valid = false;
            break;
          }
          const strength = new Map(),
            scores = new Map(),
            wide = cell(image, cursor, top, "0"),
            narrow = cell(image, cursor, top, "1");
          for (const t of templates) {
            const shape = t.digit === "1" ? narrow : wide;
            if (!shape) continue;
            // Masked normalized correlation ignores the changing icon background.
            let n = 0,
              a = 0,
              b = 0,
              aa = 0,
              bb = 0,
              ab = 0;
            for (let i = 0; i < shape.length; i++)
              if (t.mask[i]) {
                const x = shape[i],
                  y = t.shape[i];
                n++;
                a += x;
                b += y;
                aa += x * x;
                bb += y * y;
                ab += x * y;
              }
            const av = aa - (a * a) / n,
              bv = bb - (b * b) / n;
            const e =
              n < 12 || av < 0.0001 * n || bv < 0.0001 * n
                ? 1
                : 1 -
                  Math.max(
                    -1,
                    Math.min(1, (ab - (a * b) / n) / Math.sqrt(av * bv)),
                  );
            if (!scores.has(t.digit) || e < scores.get(t.digit)) {
              scores.set(t.digit, e);
              // A tiny mask cannot win by ignoring distinguishing strokes.
              strength.set(
                t.digit,
                -0.5 *
                  (n - 3) *
                  Math.log(Math.max(0.0001, 1 - (1 - e) * (1 - e))),
              );
            }
          }
          const sorted = [...scores].sort(
            (a, b) => strength.get(b[0]) - strength.get(a[0]),
          );
          if (
            sorted.length < 2 ||
            sorted[0][1] > 0.08 ||
            strength.get(sorted[0][0]) - strength.get(sorted[1][0]) <
              Math.log(100)
          ) {
            valid = false;
            break;
          }
          text += sorted[0][0];
          error += sorted[0][1];
          confidence = Math.min(
            confidence,
            Math.round((1 - sorted[0][1]) * 100),
          );
          cursor += sorted[0][0] === "1" ? 5 : 8;
        }
        if (valid && text && !/^0\d/.test(text)) {
          const r = {
            accepted: true,
            count: Number(text),
            confidence,
            error: error / text.length,
          };
          if (!readings.has(text) || readings.get(text).error > r.error)
            readings.set(text, r);
        }
      }
    const sorted = [...readings.values()].sort((a, b) => a.error - b.error);
    if (
      !sorted.length ||
      (sorted[1] && sorted[1].error - sorted[0].error < 0.025)
    )
      return null;
    return sorted[0];
  }
  return { value, cell, recognize };
});
