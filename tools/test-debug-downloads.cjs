const assert = require("node:assert/strict"),
  Debug = require("../debug-tools");
let clicked = 0,
  created = 0,
  revoked = 0,
  filename = "",
  timer,
  status,
  checked = true;
const config = {
  enabled: false,
  isDownloadEnabled: () => checked,
  onDownload: (text) => (status = text),
  URL: {
    createObjectURL() {
      created++;
      return "blob:test";
    },
    revokeObjectURL() {
      revoked++;
    },
  },
  document: {
    body: { appendChild() {} },
    createElement() {
      return {
        click() {
          clicked++;
          filename = this.download;
        },
        remove() {},
      };
    },
  },
  setTimeout(fn) {
    timer = fn;
  },
};
const stamp = Date.UTC(2026, 9, 16, 16),
  blob = {};
let d = Debug.create(config);
d.downloadFrame(blob, stamp, false);
assert.equal(clicked, 0);
d = Debug.create({ ...config, enabled: true });
d.downloadFrame(blob, stamp, true);
d.downloadFrame(blob, stamp);
assert.equal(clicked, 0);
d.downloadFrame(blob, stamp, false);
assert.equal(clicked, 1);
assert.equal(filename, "maple-track-2026-10-16T16-00-00-000Z.png");
assert.match(status, /requested/);
timer();
assert.equal(revoked, 1);
d.downloadFrame(blob, stamp, false);
assert.equal(clicked, 1);
checked = false;
d.downloadFrame(blob, stamp + 10000, false);
assert.equal(clicked, 1);
Debug.create(config).downloadFrame(blob, stamp + 10000, false);
assert.equal(created, 1);
(async () => {
  checked = true;
  let encodes = 0;
  const frame = {
    _pngBlob: blob,
    toBlob() {
      encodes++;
    },
  };
  await d.rejectFrame(frame, stamp + 20000);
  assert.equal(encodes, 0, "Debug downloads reuse the exact preview PNG");
  await Debug.create(config).rejectFrame(frame, stamp + 30000);
  assert.equal(clicked, 2, "Normal mode cannot download error frames");
  console.log(
    "Debug module: explicit rejection, timestamp, duplication, opt-out, PNG reuse and cleanup passed.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
