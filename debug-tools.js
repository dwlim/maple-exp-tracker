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
    function saveBlob(blob, timestamp, prefix, message, suffix = "") {
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download =
        prefix +
        (suffix ? suffix + "-" : "") +
        new Date(timestamp).toISOString().replace(/[:.]/g, "-") +
        ".png";
      document.body.appendChild(a);
      try {
        a.click();
        onDownload(message(new Date(timestamp)));
      } finally {
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    }

    function reasonSlug(reason) {
      const slug = String(reason || "reading-rejected")
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 56)
        .replace(/-+$/g, "");
      return slug || "reading-rejected";
    }

    function downloadDebugFrame(blob, timestamp, accepted, reason = "reading-rejected") {
      if (
        accepted !== false ||
        !enabled ||
        !isDownloadEnabled() ||
        downloadDebugFrame.lastFrame === timestamp
      )
        return false;
      downloadDebugFrame.lastFrame = timestamp;
      saveBlob(blob, timestamp, "maple-track-", (date) =>
        "Rejected-frame download requested · " +
        date.toLocaleTimeString() +
        " · " + reasonSlug(reason) + " · allow multiple downloads if prompted",
        reasonSlug(reason),
      );
      return true;
    }

    function downloadManualFrame(blob, timestamp) {
      if (!enabled || !blob) return;
      saveBlob(blob, timestamp, "maple-track-manual-", (date) =>
        "Manual screenshot download requested · " +
          date.toLocaleTimeString() +
          " · allow downloads if prompted",
      );
    }

    async function rejectImage(image, timestamp, reason = "reading-rejected", cancelled = () => false) {
      if (
        !enabled ||
        !image?.data ||
        image.data.length !== image.width * image.height * 4 ||
        !isDownloadEnabled() ||
        cancelled()
      ) return false;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      try {
        const context = canvas.getContext("2d"),
          pixels = context?.createImageData?.(image.width, image.height);
        if (!context || !pixels) return false;
        pixels.data.set(image.data);
        context.putImageData(pixels, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob || cancelled()) return false;
        saveBlob(
          blob,
          timestamp,
          "maple-track-pickup-",
          (date) =>
            "Pickup-crop diagnostic requested · " +
            date.toLocaleTimeString() +
            " · " + reasonSlug(reason) +
            " · allow multiple downloads if prompted",
          reasonSlug(reason),
        );
        return true;
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    async function rejectFrame(frame, timestamp, reason = "reading-rejected", cancelled = () => false) {
      if (!enabled || !frame || !isDownloadEnabled() || cancelled()) return false;
      const blob =
        frame._pngBlob ||
        (await new Promise((resolve) => frame.toBlob(resolve, "image/png")));
      if (blob && !cancelled()) return downloadDebugFrame(blob, timestamp, false, reason);
      return false;
    }
    return {
      downloadFrame: downloadDebugFrame,
      downloadManualFrame,
      rejectFrame,
      rejectImage,
    };
  }
  return { create };
});
