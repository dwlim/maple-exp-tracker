const { spawnSync } = require("node:child_process");
const checks = [
  ["tools/build-app.cjs", "--check"],
  ["tools/test-build.cjs"],
  ["tools/test-session.cjs"],
  ["tools/test-browser-capture.cjs"],
  ["tools/test-burst-capture.cjs"],
  ["tools/test-stream-card.cjs"],
  ["tools/test-quickslots.cjs"],
  ["tools/test-potion-costs.cjs"],
  ["tools/test-debug-downloads.cjs"],
  ["tools/test-level-ocr.cjs"],
  ["tools/test-level-inference.cjs"],
  ["tools/test-hud-regions.cjs"],
  ["tools/test-percentage-only.cjs"],
  ["tools/test-local-ocr.cjs"],
  ["tools/test-hud-font.cjs"],
  ["tools/stress-hud-font.cjs", "--strict"],
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("All application, build and OCR checks passed.");
