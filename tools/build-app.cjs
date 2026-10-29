const fs = require("node:fs");
const { render } = require("./embed-script.cjs");

const modules = [
  ["LEVEL FONT", "level-ocr.js"],
  ["HUD FONT", "hud-ocr.js"],
  ["HUD REGIONS", "hud-regions.js"],
  ["MAP NAMES", "map-name-data.js"],
  ["MAP NAME", "map-name.js"],
  ["LOCAL OCR", "local-ocr.js"],
  ["POTION COSTS", "potion-costs.js"],
  ["STREAM CARD", "stream-card.js"],
  ["SESSION", "session.js"],
  ["RECOGNITION", "recognition.js"],
  ["DEBUG TOOLS", "debug-tools.js"],
  ["DASHBOARD", "dashboard.js"],
  ["READER", "reader.js"],
  ["CAPTURE", "capture.js"],
  ["QUICKSLOT FONT", "quickslot-font.js"],
  ["QUICKSLOT SMALL", "quickslot-small.js"],
  ["QUICKSLOT OCR", "quickslot-ocr.js"],
  ["QUICKSLOT SESSION", "quickslot-session.js"],
  ["QUICKSLOT LAYOUT", "quickslot-layout.js"],
  ["QUICKSLOT ICON", "quickslot-icon.js"],
  ["QUICKSLOTS", "quickslots.js"],
  ["APP", "app.js"],
];

function orderEmbeddedModules(html) {
  const spans = modules.map(([marker]) => {
    const startMarker = `<!-- ${marker} START -->`;
    const endMarker = `<!-- ${marker} END -->`;
    const markerStart = html.indexOf(startMarker);
    const endMarkerAt = html.indexOf(endMarker);
    const start = markerStart;
    let end = endMarkerAt < 0 ? -1 : endMarkerAt + endMarker.length;
    const blockEnd = end;
    if (end >= 0 && html.slice(end, end + 2) === "\r\n") end += 2;
    else if (end >= 0 && html[end] === "\n") end += 1;
    if (markerStart < 0 || end < markerStart || html.indexOf(startMarker, markerStart + startMarker.length) >= 0 ||
        html.indexOf(endMarker, end) >= 0) {
      throw new Error(`Missing or duplicate embedded module: ${marker}`);
    }
    return { start, end, block: html.slice(start, blockEnd) };
  });
  const insertAt = Math.min(...spans.map((span) => span.start));
  let remaining = html;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    remaining = remaining.slice(0, span.start) + remaining.slice(span.end);
  }
  return remaining.slice(0, insertAt) + spans.map((span) => span.block).join("\n") + "\n" + remaining.slice(insertAt);
}

const html = fs.readFileSync("index.html", "utf8");
let next = html;
for (const [marker, file] of modules) {
  next = render(next, marker, fs.readFileSync(file, "utf8"));
}
next = orderEmbeddedModules(next);

if (process.argv.includes("--check")) {
  if (next !== html) {
    console.error("Embedded app modules are stale or out of order. Run npm run build.");
    process.exitCode = 1;
  } else console.log("All embedded app modules match source and load order.");
} else if (next !== html) {
  fs.writeFileSync("index.html", next);
  console.log("Updated embedded app modules and load order in place.");
}
