(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleDebugTools = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  function create({
    document,
    URL,
    setTimeout,
    enabled = false,
    isDownloadEnabled = () => true,
    onDownload = () => {},
  }) {
    function downloadDebugFrame(blob, timestamp, accepted) {
      if (
        accepted !== false ||
        !enabled ||
        !isDownloadEnabled() ||
        downloadDebugFrame.lastFrame === timestamp
      )
        return;
      downloadDebugFrame.lastFrame = timestamp;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download =
        "maple-track-" +
        new Date(timestamp).toISOString().replace(/[:.]/g, "-") +
        ".png";
      document.body.appendChild(a);
      try {
        a.click();
        onDownload(
          "Download requested · " +
            new Date(timestamp).toLocaleTimeString() +
            " · allow multiple downloads if prompted",
        );
      } finally {
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    }

    async function rejectFrame(frame, timestamp, cancelled = () => false) {
      if (!enabled || !frame || !isDownloadEnabled() || cancelled()) return;
      const blob =
        frame._pngBlob ||
        (await new Promise((resolve) => frame.toBlob(resolve, "image/png")));
      if (blob && !cancelled()) downloadDebugFrame(blob, timestamp, false);
    }
    return { downloadFrame: downloadDebugFrame, rejectFrame };
  }
  return { create };
});
