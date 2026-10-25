/* Only HUD crops are transferred to this local worker. No upload or server recognition. */
importScripts(
  "hud-regions.js?v=4",
  "quickslot-layout.js?v=4",
  "quickslot-font.js?v=4",
  "quickslot-small.js?v=4",
  "quickslot-ocr.js?v=4",
);
self.onmessage = ({ data: { id, kind, image, geometry } }) => {
  try {
    const result =
      kind === "layout"
        ? MapleQuickslotLayout.scan({ ...geometry, patch: image })
        : kind === "slot"
          ? MapleQuickslotOcr.recognizeSlot(image)
          : MapleQuickslotOcr.recognize(image);
    self.postMessage({ id, result });
  } catch {
    self.postMessage({ id, result: null });
  }
};
