/* Local quantity recognition only. No screenshots or readings leave this worker. */
importScripts("quickslot-font.js", "quickslot-ocr.js");
self.onmessage = ({ data: { id, image } }) => {
  try {
    self.postMessage({ id, result: MapleQuickslotOcr.recognize(image) });
  } catch {
    self.postMessage({ id, result: null });
  }
};
