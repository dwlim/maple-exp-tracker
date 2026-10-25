/* Only HUD crops are transferred to this local worker. No upload or server recognition. */
importScripts(
  "hud-regions.js?v=2",
  "quickslot-layout.js?v=2",
  "quickslot-font.js?v=2",
  "quickslot-ocr.js?v=2",
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
