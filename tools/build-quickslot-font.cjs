const fs = require("node:fs"),
  z = require("node:zlib");
const font = [];
for (const f of require("./quickslot-font-fixtures.json")) {
  const data = z.inflateSync(Buffer.from(f.rgba, "base64"));
  for (let k = 0; k < f.text.length; k++) {
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
            Math.max(r, g, b) - mn > 80
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
