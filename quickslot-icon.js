(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleQuickslotIcon = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  // Only call a slot empty when its icon's center is uniformly the pale empty
  // cell background. The quantity and key label areas are deliberately left
  // out. Uncertain, gray, or covered icons return false and keep the mapping.
  function clearlyEmpty(image, box) {
    if (
      !image?.data ||
      !box ||
      !Number.isFinite(box.x) ||
      !Number.isFinite(box.y) ||
      !Number.isFinite(box.w) ||
      !Number.isFinite(box.h) ||
      box.w < 12 ||
      box.h < 12
    )
      return false;
    const x0 = Math.max(0, Math.floor(box.x + box.w * 0.16)),
      x1 = Math.min(image.width, Math.ceil(box.x + box.w * 0.84)),
      y0 = Math.max(0, Math.floor(box.y + box.h * 0.28)),
      y1 = Math.min(image.height, Math.ceil(box.y + box.h * 0.7));
    if (x1 - x0 < 5 || y1 - y0 < 5) return false;
    let count = 0,
      sum = 0,
      squares = 0,
      chromatic = 0,
      edges = 0;
    const lumaAt = (x, y) => {
      const i = (y * image.width + x) * 4,
        r = image.data[i],
        g = image.data[i + 1],
        b = image.data[i + 2];
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * image.width + x) * 4,
          r = image.data[i],
          g = image.data[i + 1],
          b = image.data[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) chromatic++;
        const value = lumaAt(x, y);
        sum += value;
        squares += value * value;
        count++;
        if (x > x0 && Math.abs(value - lumaAt(x - 1, y)) > 22) edges++;
      }
    if (!count) return false;
    const mean = sum / count,
      deviation = Math.sqrt(Math.max(0, squares / count - mean * mean));
    return (
      mean >= 215 &&
      mean <= 253 &&
      deviation <= 17 &&
      chromatic / count <= 0.025 &&
      edges / count <= 0.065
    );
  }

  return { clearlyEmpty };
});
