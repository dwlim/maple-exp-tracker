(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./hud-regions"));
  else root.MapleQuickslotLayout = factory(root.MapleHudRegions);
})(typeof window === "undefined" ? globalThis : window, function (Regions) {
  "use strict";
  function controlVisible(image, a) {
    const color = (x, y, blue) => {
      x = Math.round(x);
      y = Math.round(y);
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
      const p = (y * image.width + x) * 4,
        r = image.data[p],
        g = image.data[p + 1],
        b = image.data[p + 2];
      return blue
        ? b > 90 && b > r * 1.4 && g > r * 1.2
        : r > 110 && r > g * 1.7 && r > b * 1.3;
    };
    return (
      [0.12, 0.85].every((t) =>
        color(a.x + a.w * t, a.y + a.h * 0.18, false),
      ) &&
      [1, 2].every((n) =>
        [0.12, 0.85].every((t) =>
          color(a.x + a.w * (n + t), a.y + a.h * 0.18, true),
        ),
      )
    );
  }
  function prepare(image, previous) {
    const validPrevious =
      previous?.width === image.width &&
      previous?.height === image.height &&
      previous.anchor?.kind === "cash-shop" &&
      controlVisible(image, previous.anchor);
    // Cash Shop and the blue static button row are separate alignment
    // anchors. Potion slots are positioned relative to Cash Shop, so never
    // reuse the blue OCR anchor for quickslot geometry.
    const a = validPrevious
      ? previous.anchor
      : Regions.anchors(image, "cash-shop")[0];
    if (!a) return null;
    const previousGrid =
      previous?.box &&
      previous.anchor?.kind === "cash-shop" &&
      (previous.rows === 2 || previous.rows === 3)
        ? {
            rows: previous.rows,
            box: {
              x:
                a.x +
                (previous.box.x - previous.anchor.x) * (a.w / previous.anchor.w),
              y:
                a.y +
                (previous.box.y - previous.anchor.y) * (a.h / previous.anchor.h),
              w: previous.box.w * (a.w / previous.anchor.w),
              h: previous.box.h * (a.h / previous.anchor.h),
            },
          }
        : null;
    const x = Math.max(0, Math.floor(a.x + a.w * 0.72)),
      y = Math.max(0, Math.floor(a.y - a.h * 4.7)),
      patch = Regions.crop(image, { x, y, w: a.w * 2.6, h: a.h * 4.35 });
    return {
      patch,
      anchor: a,
      previousGrid,
      origin: { x, y },
      width: image.width,
      height: image.height,
    };
  }
  function scan({ patch, anchor: a, origin, width, height, previousGrid }) {
    let light = null;
    function buildLightMap() {
      if (light) return;
      light = new Float32Array(patch.width * patch.height);
      for (let p = 0; p < light.length; p++) {
        const i = p * 4,
          r = patch.data[i],
          g = patch.data[i + 1],
          b = patch.data[i + 2],
          mn = Math.min(r, g, b);
        light[p] = Math.max(r, g, b) - mn > 80 ? 0 : mn / 255;
      }
    }
    const value = (x, y) => {
      x = Math.round(x - origin.x);
      y = Math.round(y - origin.y);
      if (x < 0 || y < 0 || x >= patch.width || y >= patch.height) return 0;
      const p = y * patch.width + x;
      if (light) return light[p];
      const i = p * 4,
        r = patch.data[i],
        g = patch.data[i + 1],
        b = patch.data[i + 2],
        mn = Math.min(r, g, b);
      return Math.max(r, g, b) - mn > 80 ? 0 : mn / 255;
    };
    function edge(x, y, vertical) {
      let peak = 0;
      for (const d of [-1, 0, 1])
        peak = Math.max(
          peak,
          value(x + (vertical ? d : 0), y + (vertical ? 0 : d)),
        );
      const d = Math.max(2, Math.round(a.h * 0.07)),
        dark = Math.min(
          value(x + (vertical ? -d : 0), y + (vertical ? 0 : -d)),
          value(x + (vertical ? d : 0), y + (vertical ? 0 : d)),
        );
      return (
        Math.min(1, Math.max(0, (peak - 0.25) / 0.45)) *
        Math.min(1, Math.max(0, (peak - dark) / 0.25))
      );
    }
    function score(box) {
      const sides = [0, 0, 0, 0];
      for (let i = 0; i < 16; i++) {
        const u = 0.1 + (0.8 * i) / 15;
        sides[0] += edge(box.x + box.w * u, box.y, false);
        sides[1] += edge(box.x + box.w * u, box.y + box.h, false);
        sides[2] += edge(box.x, box.y + box.h * u, true);
        sides[3] += edge(box.x + box.w, box.y + box.h * u, true);
      }
      for (let i = 0; i < 4; i++) sides[i] /= 16;
      // A continuous outer rail distinguishes a panel from an internal row boundary.
      const topRail =
        [0.25, 0.5, 0.75].reduce(
          (sum, u) => sum + edge(box.x + box.w * u, box.y, false),
          0,
        ) / 3;
      return {
        quality: (sides.reduce((s, v) => s + v, 0) / 4) * 0.8 + topRail * 0.2,
        sides,
      };
    }
    function layoutFor(box, rows, result) {
      const crossbar = [0.25, 0.5, 0.75].map((u) =>
        edge(box.x + box.w * u, box.y, false),
      );
      if (crossbar.filter((v) => v > 0.45).length < 2) return null;
      const cols = 4,
        slots = [];
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          const pitchX = (box.w - a.h * 0.18) / 4,
            pitchY = (box.h - a.h * 0.2) / rows,
            x = box.x + a.h * 0.1 + pitchX * col,
            y = box.y + a.h * 0.1 + pitchY * row;
          slots.push({
            index: row * 4 + col,
            row,
            col,
            box: { x, y, w: pitchX, h: pitchY },
            quantity: {
              x: (x - a.h * 0.02) / width,
              y: (y + pitchY * 0.615 - 1) / height,
              w: (pitchX * 0.98) / width,
              h: (pitchY * 0.34 + 2) / height,
            },
          });
        }
      let verified = 0;
      for (const slot of slots) {
        const q = slot.box;
        let ink = 0;
        for (const yy of [0.15, 0.25])
          for (const xx of [0.2, 0.35, 0.5, 0.65, 0.8])
            ink += value(q.x + q.w * xx, q.y + q.h * yy);
        ink /= 10;
        let gap = 1;
        for (const dx of [-0.07, -0.04, -0.01])
          gap = Math.min(
            gap,
            (value(q.x + q.w * dx, q.y + q.h * 0.3) +
              value(q.x + q.w * dx, q.y + q.h * 0.6)) /
              2,
          );
        if (ink > 0.35 && ink - gap > 0.08) verified++;
      }
      if (verified < Math.ceil(slots.length * 0.6)) return null;
      return {
        verified,
        rows,
        cols,
        count: rows * 4,
        kind: "4x" + rows,
        slots,
        box,
        quality: result.quality,
        anchor: a,
        width,
        height,
      };
    }
    if (previousGrid) {
      const result = score(previousGrid.box);
      if (result.quality >= 0.6 && Math.min(...result.sides) >= 0.4) {
        const layout = layoutFor(previousGrid.box, previousGrid.rows, result);
        if (layout) return layout;
      }
    }
    buildLightMap();
    const best = [];
    for (const rows of [2, 3]) {
      for (const wf of [1.94, 1.98, 2.02, 2.06, 2.1])
        for (const dx of [
          -0.12, -0.08, -0.04, -0.02, 0, 0.02, 0.04, 0.08, 0.12,
        ])
          for (const dy of [
            -0.24, -0.18, -0.12, -0.08, -0.06, -0.04, 0, 0.04, 0.06, 0.08, 0.12,
            0.18, 0.24,
          ])
            for (const hf of [0.97, 1, 1.03]) {
              const w = a.w * wf,
                h = ((w * rows) / 4) * hf,
                x = a.x + a.w * (3.06 + dx) - w,
                y = a.y - a.h * (1 + dy) - h,
                box = { x, y, w, h };
              if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
              const result = score(box);
              if (result.quality >= 0.6 && Math.min(...result.sides) >= 0.4)
                best.push({ ...box, ...result, rows });
            }
    }
    best.sort((a, b) => b.quality - a.quality);
    for (const b of best) {
      const layout = layoutFor(b, b.rows, b);
      if (layout) return layout;
    }
    return null;
  }
  function detect(image, previous) {
    const p = prepare(image, previous);
    return p ? scan(p) : null;
  }
  return { prepare, scan, detect };
});
