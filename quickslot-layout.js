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
    const a =
      previous?.width === image.width &&
      previous?.height === image.height &&
      previous.anchor &&
      controlVisible(image, previous.anchor)
        ? previous.anchor
        : Regions.anchors(image)[0];
    if (!a) return null;
    const x = Math.max(0, Math.floor(a.x + a.w * 0.72)),
      y = Math.max(0, Math.floor(a.y - a.h * 4.7)),
      patch = Regions.crop(image, { x, y, w: a.w * 2.6, h: a.h * 4.35 });
    return {
      patch,
      anchor: a,
      origin: { x, y },
      width: image.width,
      height: image.height,
    };
  }
  function scan({ patch, anchor: a, origin, width, height }) {
    const light = new Float32Array(patch.width * patch.height);
    for (let p = 0; p < light.length; p++) {
      const i = p * 4,
        r = patch.data[i],
        g = patch.data[i + 1],
        b = patch.data[i + 2],
        mn = Math.min(r, g, b);
      light[p] = Math.max(r, g, b) - mn > 80 ? 0 : mn / 255;
    }
    const value = (x, y) => {
      x = Math.round(x - origin.x);
      y = Math.round(y - origin.y);
      return x >= 0 && y >= 0 && x < patch.width && y < patch.height
        ? light[y * patch.width + x]
        : 0;
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
      const crossbar = [0.25, 0.5, 0.75].map((u) =>
        edge(b.x + b.w * u, b.y, false),
      );
      if (crossbar.filter((v) => v > 0.45).length < 2) continue;
      const cols = 4,
        slots = [];
      for (let row = 0; row < b.rows; row++)
        for (let col = 0; col < cols; col++) {
          const pitchX = (b.w - a.h * 0.18) / 4,
            pitchY = (b.h - a.h * 0.2) / b.rows,
            x = b.x + a.h * 0.1 + pitchX * col,
            y = b.y + a.h * 0.1 + pitchY * row;
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
      if (verified < Math.ceil(slots.length * 0.6)) continue;
      return {
        verified,
        rows: b.rows,
        cols,
        count: b.rows * 4,
        kind: "4x" + b.rows,
        slots,
        box: { x: b.x, y: b.y, w: b.w, h: b.h },
        quality: b.quality,
        anchor: a,
        width,
        height,
      };
    }
    return null;
  }
  function detect(image, previous) {
    const p = prepare(image, previous);
    return p ? scan(p) : null;
  }
  return { prepare, scan, detect };
});
