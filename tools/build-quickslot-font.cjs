const fs = require("node:fs"),
  z = require("node:zlib");
const fixtures = require("./quickslot-font-fixtures.json");
const small = fixtures
  .filter((f) => f.height === 12)
  .map((f) => ({ ...f, data: z.inflateSync(Buffer.from(f.rgba, "base64")) }));
const palette = Array.from({ length: 20 }, (_, v) => {
  const y = Math.floor(((v + 0.5) / 20) * 12),
    bins = new Map();
  for (const f of small)
    for (let x = 0; x < f.width; x++) {
      const i = (y * f.width + x) * 4,
        r = f.data[i],
        g = f.data[i + 1],
        b = f.data[i + 2],
        mn = Math.min(r, g, b);
      if (
        mn <= 60 ||
        Math.max(r, g, b) - mn > 85 ||
        b + 8 < r ||
        g + 8 < r ||
        (mn < 180 && b - r < 20)
      )
        continue;
      const key = (r >> 3) + "," + (g >> 3) + "," + (b >> 3),
        bin = bins.get(key) || [0, 0, 0, 0];
      bin[0]++;
      bin[1] += r;
      bin[2] += g;
      bin[3] += b;
      bins.set(key, bin);
    }
  const best = [...bins.values()].sort((a, b) => b[0] - a[0])[0];
  return !best || best[0] < 3
    ? -1
    : (Math.round(best[1] / best[0]) << 16) |
        (Math.round(best[2] / best[0]) << 8) |
        Math.round(best[3] / best[0]);
});
const Small = require("../quickslot-small");
const font = [];
for (const f of fixtures) {
  const data = z.inflateSync(Buffer.from(f.rgba, "base64"));
  let cursor = 0;
  for (let k = 0; k < f.text.length; k++) {
    if (f.height === 12) {
      const cell = Small.cell({ ...f, data }, palette, cursor, 0, f.text[k]);
      if (!cell) throw Error("Incomplete manually labelled crop: " + f.name);
      font.push({
        digit: f.text[k],
        palette,
        smallCell: cell.map((v) => Math.round(v * 15).toString(16)).join(""),
      });
      cursor += f.text[k] === "1" ? 4 : 8;
      continue;
    }
    let mask = "";
    for (let v = 0; v < 20; v++)
      for (let u = 0; u < 15; u++) {
        const x = Math.floor(((k + (u + 0.5) / 15) * f.width) / f.text.length),
          y = Math.floor(((v + 0.5) / 20) * f.height),
          i = (y * f.width + x) * 4,
          r = data[i],
          g = data[i + 1],
          b = data[i + 2],
          mn = Math.min(r, g, b),
          value =
            Math.max(r, g, b) - mn > 80 || b + 8 < r || g + 8 < r
              ? 0
              : Math.max(0, Math.min(1, (mn - 45) / 130));
        mask += Math.round(value * 15).toString(16);
      }
    font.push({ digit: f.text[k], mask });
  }
}
fs.writeFileSync(
  "quickslot-font.js",
  `// Generated from manually transcribed quantity-only crops. Rebuild with node tools/build-quickslot-font.cjs.\n(function(root){const font=${JSON.stringify(font)};if(typeof module==='object'&&module.exports)module.exports=font;else root.MapleQuickslotFont=font;})(typeof window==='undefined'?globalThis:window);\n`,
);
