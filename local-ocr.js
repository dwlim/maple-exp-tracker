(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports ? require("./map-name") : root.MapleMapName,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MapleLocalOcr = api;
})(typeof window === "undefined" ? globalThis : window, function (MapName) {
  function prepare(image, kind, mode) {
    let { width: w, height: h, data } = image,
      l = 0,
      t = 0,
      r = w,
      b = h,
      bracketColumns = [],
      crispContext = false;
    if (kind === "level" && mode === "soft") {
      l = w;
      t = h;
      r = 0;
      b = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            R = data[i],
            G = data[i + 1],
            B = data[i + 2];
          if (R > 100 && G / R > 0.25 && G / R < 0.85 && B / R < 0.4) {
            l = Math.min(l, x);
            r = Math.max(r, x + 1);
            t = Math.min(t, y);
            b = Math.max(b, y + 1);
          }
        }
      if (r <= l || b <= t) return null;
    }
    if (kind === "exp" || kind === "exp-context") {
      const groups = [];
      let start = null,
        last = -1;
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let y = 0; y < h; y++) {
          const i = (y * w + x) * 4;
          if (data[i + 1] - data[i] > 12 && data[i + 1] - data[i + 2] > 20) n++;
        }
        if (n >= 2) {
          if (start === null) start = x;
          else if (x - last > 3) {
            groups.push([start, last + 1]);
            start = x;
          }
          last = x;
        }
      }
      if (start !== null) groups.push([start, last + 1]);
      if (groups.length < 2) return null;
      // Keep both fields in one line when the native amount is unclear.
      // Green bracket columns provide separators, not guessed numeric characters.
      if (kind === "exp-context") {
        bracketColumns = [groups[0], groups.at(-1)];
        r = groups.at(-1)[1];
        let top = h,
          bottom = 0;
        for (const [left, right] of bracketColumns)
          for (let x = left; x < right; x++)
            for (let y = 0; y < h; y++) {
              const i = (y * w + x) * 4;
              if (
                data[i + 1] - data[i] > 12 &&
                data[i + 1] - data[i + 2] > 20
              ) {
                top = Math.min(top, y);
                bottom = Math.max(bottom, y + 1);
              }
            }
        crispContext = bottom - top <= 8;
        t = Math.max(0, top - 2);
        b = Math.min(h, bottom + 2);
      } else {
        l = groups[0][1];
        r = groups.at(-1)[0];
      }
      if (r - l < 3) return null;
    }
    const sw = r - l,
      sh = b - t,
      gray = new Float32Array(sw * sh);
    let low = 255,
      high = 0;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const i = ((t + y) * w + l + x) * 4,
          R = data[i],
          G = data[i + 1],
          B = data[i + 2];
        let v;
        if (kind === "level")
          v =
            mode === "blue"
              ? B
              : 255 *
                (1 -
                  Math.max(
                    0,
                    Math.min(
                      1,
                      (Math.min(G, B) / Math.max(R, 1) - 0.22) / 0.68,
                    ),
                  ));
        else
          v =
            255 -
            Math.min(
              255,
              Math.max(
                0,
                ((Math.max(Math.min(R, G, B), G - R > 8 && G - B > 12 ? G : 0) -
                  55) *
                  255) /
                  145,
              ),
            );
        if (
          kind === "exp-context" &&
          bracketColumns.some(([left, right]) => x + l >= left && x + l < right)
        )
          v = 255;
        gray[y * sw + x] = v;
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
    if (kind === "level" && mode === "blue")
      for (let i = 0; i < gray.length; i++)
        gray[i] = 255 - ((gray[i] - low) * 255) / Math.max(1, high - low);
    if (kind === "exp" && mode === "binary")
      for (let i = 0; i < gray.length; i++) gray[i] = gray[i] < 150 ? 0 : 255;
    const scale =
        kind === "level" && mode === "blue" ? 4 : mode === "large" ? 8 : 6,
      pad = 20,
      width = sw * scale + pad * 2,
      height = sh * scale + pad * 2,
      out = new Uint8ClampedArray(width * height * 4).fill(255);
    const sinc = (x) =>
        Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x),
      weights = (size) =>
        Array.from({ length: size * scale }, (_, d) => {
          const center = (d + 0.5) / scale - 0.5,
            terms = [];
          let sum = 0;
          for (
            let i = Math.max(0, Math.floor(center) - 2);
            i <= Math.min(size - 1, Math.floor(center) + 3);
            i++
          ) {
            const delta = center - i,
              v = Math.abs(delta) < 3 ? sinc(delta) * sinc(delta / 3) : 0;
            terms.push([i, v]);
            sum += v;
          }
          return terms.map(([i, v]) => [i, v / sum]);
        }),
      wx = weights(sw),
      wy = weights(sh),
      horizontal = new Float32Array(sw * scale * sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw * scale; x++) {
        let sum = 0;
        for (const [i, v] of wx[x]) sum += gray[y * sw + i] * v;
        horizontal[y * sw * scale + x] = Math.max(0, Math.min(255, sum));
      }
    for (let y = 0; y < sh * scale; y++)
      for (let x = 0; x < sw * scale; x++) {
        let v = 0;
        for (const [i, weight] of wy[y])
          v += horizontal[i * sw * scale + x] * weight;
        const j = ((y + pad) * width + x + pad) * 4;
        out[j] =
          out[j + 1] =
          out[j + 2] =
            Math.max(0, Math.min(255, Math.round(v)));
      }
    // Sharpen the separated full-EXP fields after resampling. This avoids tiny
    // antialiased strokes turning into extra characters while keeping both fields.
    if (crispContext) {
      const threshold = mode === "large" ? 190 : 160;
      for (let i = 0; i < out.length; i += 4)
        out[i] = out[i + 1] = out[i + 2] = out[i] < threshold ? 0 : 255;
    }
    if (kind === "exp-context" && mode === "binary")
      for (let i = 0; i < out.length; i += 4)
        out[i] = out[i + 1] = out[i + 2] = out[i] < 150 ? 0 : 255;
    return { width, height, data: out };
  }
  function normalize(text, kind) {
    text = text.trim().replace(/\s/g, "");
    if (kind === "level") {
      text = text.replace(/[LV.]/g, "");
      return /^\d{1,3}$/.test(text) && Number(text) >= 1 && Number(text) <= 100
        ? text
        : null;
    }
    text = text.replace(/,/g, ".");
    if (/^\d{1,3}\.\d{2}%$/.test(text)) text = "[" + text + "]";
    if (/^\[\d{1,3}\.\d{2}%\]$/.test(text)) {
      const pct = Number(text.slice(1, -2));
      return pct <= 100 ? text : null;
    }
    return /^\d[\d.]*\[\d+\.\d{2}%\]$/.test(text) ? text : null;
  }
  function parseMeso(text) {
    const clean = String(text || "").trim().replace(/\s/g, "");
    if (!/^(?:\d{1,3}(?:[,\.]\d{3})+|\d{1,12})$/.test(clean)) return null;
    const amount = Number(clean.replace(/[,\.]/g, ""));
    return Number.isSafeInteger(amount) && amount <= 2147483647 ? amount : null;
  }
  function scaleMesoScan(image, maxWidth = 1920) {
    if (!image?.data || !image.width || !image.height) return null;
    const scale = Math.min(1, maxWidth / image.width),
      width = Math.max(1, Math.round(image.width * scale)),
      height = Math.max(1, Math.round(image.height * scale));
    if (width === image.width && height === image.height) return { image, scaleX: 1, scaleY: 1 };
    const data = new Uint8ClampedArray(width * height * 4),
      sx = image.width / width, sy = image.height / height;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const sx0 = Math.floor(x * sx), sy0 = Math.floor(y * sy),
          sx1 = Math.min(image.width, Math.max(sx0 + 1, Math.floor((x + 1) * sx))),
          sy1 = Math.min(image.height, Math.max(sy0 + 1, Math.floor((y + 1) * sy))),
          target = (y * width + x) * 4;
        let red = 0, green = 0, blue = 0, alpha = 0, count = 0;
        for (let py = sy0; py < sy1; py++)
          for (let px = sx0; px < sx1; px++) {
            const source = (py * image.width + px) * 4;
            red += image.data[source]; green += image.data[source + 1];
            blue += image.data[source + 2]; alpha += image.data[source + 3]; count++;
          }
        data[target] = red / count; data[target + 1] = green / count;
        data[target + 2] = blue / count; data[target + 3] = alpha / count;
      }
    return { image: { width, height, data }, scaleX: image.width / width, scaleY: image.height / height };
  }
  function cropPixels(image, box) {
    const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y)),
      x1 = Math.min(image.width, Math.ceil(box.x + box.w)), y1 = Math.min(image.height, Math.ceil(box.y + box.h)),
      width = x1 - x0, height = y1 - y0;
    if (width < 2 || height < 2) return null;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      data.set(image.data.subarray(((y + y0) * image.width + x0) * 4, ((y + y0) * image.width + x1) * 4), y * width * 4);
    return { width, height, data };
  }
  function createMesoReference(image) {
    if (!image?.data || image.width < 180 || image.height < 28) return null;
    // The row's lower padding varies between inventory layouts. Match only the
    // coin and the complete white amount box, whose size and alignment stay fixed.
    const amount = { x: 22, y: 0, w: 148, h: 19 },
      width = Math.min(image.width, amount.x + amount.w + 10),
      height = Math.min(image.height, amount.y + amount.h + 1),
      gray = new Uint8Array(width * height), features = [];
    const grayAt = (x, y) => {
      const i = (y * image.width + x) * 4;
      return Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
    };
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) gray[y * width + x] = grayAt(x, y);
    for (let y = 1; y < height - 1; y += 2)
      for (let x = 1; x < width - 1; x += 2) {
        // Keep the fixed black outline as alignment evidence, but mask the
        // variable digits inside it.
        if (x >= amount.x + 4 && x < amount.x + amount.w - 4 && y >= amount.y + 4 && y < amount.y + amount.h - 4) continue;
        const value = grayAt(x, y), edge = Math.max(
          Math.abs(value - grayAt(x - 1, y)), Math.abs(value - grayAt(x + 1, y)),
          Math.abs(value - grayAt(x, y - 1)), Math.abs(value - grayAt(x, y + 1)),
        );
        if (edge >= 9) features.push([x, y, value]);
      }
    return features.length >= 50 ? {
      width, height, amount, gray, features,
      border: { x: 2 / amount.w, y: 2 / amount.h, w: 145 / amount.w, h: 16 / amount.h },
    } : null;
  }
  function scaleMesoReference(reference, scale) {
    const width = Math.max(1, Math.round(reference.width * scale)), height = Math.max(1, Math.round(reference.height * scale)),
      sx = reference.width / width, sy = reference.height / height, gray = new Uint8Array(width * height),
      amount = { x: reference.amount.x / sx, y: reference.amount.y / sy, w: reference.amount.w / sx, h: reference.amount.h / sy },
      features = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor(x * sx), y0 = Math.floor(y * sy),
          x1 = Math.min(reference.width, Math.max(x0 + 1, Math.floor((x + 1) * sx))),
          y1 = Math.min(reference.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
        let total = 0, count = 0;
        for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) { total += reference.gray[py * reference.width + px]; count++; }
        gray[y * width + x] = total / count;
      }
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        if (x >= amount.x + 1 && x < amount.x + amount.w - 1 && y >= amount.y + 1 && y < amount.y + amount.h - 1) continue;
        const value = gray[y * width + x], edge = Math.max(
          Math.abs(value - gray[y * width + x - 1]), Math.abs(value - gray[y * width + x + 1]),
          Math.abs(value - gray[(y - 1) * width + x]), Math.abs(value - gray[(y + 1) * width + x]),
        );
        if (edge >= 8) features.push([x, y, value]);
      }
    return { width, height, amount, features };
  }
  function locateMesoReference(image, reference, onPreview = () => {}) {
    if (!image?.data || !reference?.features?.length) return null;
    const gray = new Uint8Array(image.width * image.height);
    for (let i = 0, p = 0; i < image.data.length; i += 4, p++)
      gray[p] = Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
    const coinMatches = (x, y, scale) => {
      const coin = { x: x + scale * 8, y: y + scale * 3, w: scale * 15, h: scale * 13 };
      let gold = 0, count = 0;
      for (let py = Math.max(0, Math.floor(coin.y)); py < Math.min(image.height, Math.ceil(coin.y + coin.h)); py++)
        for (let px = Math.max(0, Math.floor(coin.x)); px < Math.min(image.width, Math.ceil(coin.x + coin.w)); px++) {
          const i = (py * image.width + px) * 4, r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
          count++;
          if (r > 130 && g > 70 && r > g * 1.12 && g > b * 1.1 && r - b > 35) gold++;
        }
      return count > 0 && gold / count >= 0.12;
    };
    const coarseCandidates = [], scales = [0.5, 0.7, 0.85, 0.95, 1, 1.05, 1.2, 1.45, 1.75, 2.1],
      addCoarse = (candidate) => {
        const duplicate = coarseCandidates.findIndex((prior) =>
          Math.abs(candidate.cx - prior.cx) < Math.min(candidate.width, prior.width) * 0.38 &&
          Math.abs(candidate.cy - prior.cy) < Math.min(candidate.height, prior.height) * 0.8,
        );
        if (duplicate >= 0) {
          if (candidate.score < coarseCandidates[duplicate].score) coarseCandidates[duplicate] = candidate;
        } else coarseCandidates.push(candidate);
        coarseCandidates.sort((a, b) => a.score - b.score);
        if (coarseCandidates.length > 10) coarseCandidates.length = 10;
      };
    // Find the small gold coin by color first. A full-frame coarse grid misses
    // otherwise good matches when the HUD sits between grid rows, and wastes
    // most of its work on background. The coin anchor narrows matching to a
    // handful of plausible template origins without assuming a fixed screen size.
    const goldMask = new Uint8Array(image.width * image.height), visited = new Uint8Array(image.width * image.height);
    for (let p = 0, i = 0; p < goldMask.length; p++, i += 4) {
      const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
      if (r > 130 && g > 70 && r > g * 1.12 && g > b * 1.1 && r - b > 35) goldMask[p] = 1;
    }
    const goldComponents = [], queue = new Int32Array(Math.min(goldMask.length, 4096));
    for (let start = 0; start < goldMask.length; start++) {
      if (!goldMask[start] || visited[start]) continue;
      let head = 0, tail = 0, minX = image.width, minY = image.height, maxX = 0, maxY = 0;
      queue[tail++] = start; visited[start] = 1;
      while (head < tail) {
        const index = queue[head++], px = index % image.width, py = (index / image.width) | 0;
        minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, next = ny * image.width + nx;
          if (nx >= 0 && ny >= 0 && nx < image.width && ny < image.height && goldMask[next] && !visited[next]) {
            visited[next] = 1;
            if (tail < queue.length) queue[tail++] = next;
          }
        }
      }
      const width = maxX - minX + 1, height = maxY - minY + 1;
      if (tail >= 14 && width >= 5 && width <= 22 && height >= 5 && height <= 22)
        goldComponents.push({ x: minX, y: minY, width, height, pixels: tail });
    }
    for (const component of goldComponents) for (const scale of scales) {
      // In the supplied reference, the colored coin's upper-left is at (11,6).
      const originX = component.x - Math.round(11 * scale), originY = component.y - Math.round(6 * scale),
        scaled = scaleMesoReference(reference, scale), { width, height } = scaled;
      if (width < 48 || height < 8 || width >= image.width || height >= image.height || scaled.features.length < 24) continue;
      const points = scaled.features.filter((_, i) => i % Math.max(1, Math.ceil(scaled.features.length / 180)) === 0);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = originX + dx, y = originY + dy;
        if (x < 0 || y < 0 || x + width >= image.width || y + height >= image.height || !coinMatches(x, y, scale)) continue;
        let error = 0;
        for (const [fx, fy, value] of points) error += Math.abs(gray[(y + fy) * image.width + x + fx] - value);
        addCoarse({ x, y, scale, width, height, cx: x + width / 2, cy: y + height / 2, score: error / points.length });
      }
    }
    if (!coarseCandidates.length) return null;
    const matches = [], addMatch = (match) => {
      const duplicate = matches.findIndex((prior) =>
        Math.abs(match.cx - prior.cx) < Math.min(match.width, prior.width) * 0.45 &&
        Math.abs(match.cy - prior.cy) < Math.max(match.height, prior.height),
      );
      if (duplicate >= 0) {
        if (match.score < matches[duplicate].score) matches[duplicate] = match;
      } else matches.push(match);
      matches.sort((a, b) => a.score - b.score);
    };
    for (const candidate of coarseCandidates.slice(0, 8))
      for (const scale of [0.92, 0.96, 1, 1.04, 1.08].map((factor) => candidate.scale * factor)) {
        const scaled = scaleMesoReference(reference, scale), { width, height, features, amount } = scaled;
        if (features.length < 24) continue;
        for (let dy = -6; dy <= 6; dy += 2)
          for (let dx = -6; dx <= 6; dx += 2) {
            const x = candidate.x + dx, y = candidate.y + dy;
            if (x < 0 || y < 0 || x + width >= image.width || y + height >= image.height) continue;
            let error = 0;
            for (const [fx, fy, value] of features) error += Math.abs(gray[(y + fy) * image.width + x + fx] - value);
            const score = error / features.length;
            if (score <= 35 && coinMatches(x, y, scale)) addMatch({ x, y, width, height, cx: x + width / 2, cy: y + height / 2, amount, scale, score });
          }
      }
    const best = matches[0], second = best && matches.find((match) =>
      Math.abs(match.cx - best.cx) > best.width * 0.5 || Math.abs(match.cy - best.cy) > best.height,
    );
    if (!best || best.score > 24 || (second && second.score - best.score < 2)) return null;
    const x = best.x + best.amount.x, y = best.y + best.amount.y,
      w = best.amount.w, h = best.amount.h,
      amountImage = cropPixels(image, { x, y, w, h });
    if (!amountImage) return null;
    try { onPreview(amountImage); } catch {}
    if (!isMesoField(amountImage)) return null;
    return {
      region: { x: x / image.width, y: y / image.height, w: w / image.width, h: h / image.height },
      amountImage, score: best.score, border: reference.border,
    };
  }
  function loadMesoReference(document, url) {
    return new Promise((resolve) => {
      const image = document.createElement("img");
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0);
          const reference = createMesoReference(context.getImageData(0, 0, canvas.width, canvas.height));
          canvas.width = 0; canvas.height = 0;
          resolve(reference);
        } catch { resolve(null); }
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }
  async function locateMesoField(image, recognize, onPreview = () => {}) {
    const scaled = scaleMesoScan(image);
    if (!scaled) return null;
    const scan = await recognize(scaled.image, "meso-scan"), words = scan.words || [],
      labels = words.filter((word) => /^MESOS?$/i.test(String(word.text || "").trim()) && word.bbox),
      candidates = [];
    for (const label of labels) {
      const lb = label.bbox,
        lh = Math.max(1, lb.y1 - lb.y0);
      for (const word of words) {
        const text = String(word.text || "").trim(), b = word.bbox;
        if (!b || !/^\d[\d,.]*$/.test(text) || parseMeso(text) === null || (word.confidence ?? 0) < 25) continue;
        const h = Math.max(1, b.y1 - b.y0), gap = lb.x0 - b.x1,
          centerDelta = Math.abs((lb.y0 + lb.y1 - b.y0 - b.y1) / 2);
        if (gap < -lh * 0.25 || gap > lh * 3 || centerDelta > Math.max(lh, h) * 0.85) continue;
        candidates.push({ b, h, label, score: gap / lh + centerDelta / Math.max(lh, h) - (word.confidence ?? 0) / 500 });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    if (!candidates.length || (candidates.length > 1 && candidates[1].score - candidates[0].score < 0.35)) return null;
    const { b, h, label } = candidates[0], sx = scaled.scaleX, sy = scaled.scaleY,
      lb = label.bbox, labelHeight = Math.max(1, lb.y1 - lb.y0),
      fieldWidth = Math.max(labelHeight * 12, b.x1 - b.x0 + labelHeight * 4) * sx,
      fieldHeight = Math.min(image.height, Math.max(labelHeight * 1.8, h * 1.8) * sy),
      right = Math.min(image.width, lb.x0 * sx - labelHeight * sx * 0.2),
      x = Math.max(0, right - fieldWidth),
      y = Math.max(0, Math.min(image.height - fieldHeight, (lb.y0 + lb.y1) * sy / 2 - fieldHeight / 2)),
      region = { x: x / image.width, y: y / image.height, w: (right - x) / image.width, h: fieldHeight / image.height },
      amountImage = cropPixels(image, { x, y, w: right - x, h: fieldHeight });
    if (!amountImage) return null;
    try { onPreview(amountImage); } catch {}
    if (!isMesoField(amountImage)) return null;
    return { region, amountImage };
  }
  function prepareMeso(image, threshold = null) {
    if (!image?.data || !image.width || !image.height) return null;
    const scale = 4, pad = 16, width = image.width * scale + pad * 2,
      height = image.height * scale + pad * 2,
      data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4,
          gray = Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114),
          value = threshold === null ? gray : gray < threshold ? 0 : 255;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const j = ((y * scale + dy + pad) * width + x * scale + dx + pad) * 4;
            data[j] = data[j + 1] = data[j + 2] = value;
          }
      }
    return { width, height, data };
  }
  function mesoAdaptiveThreshold(image) {
    const histogram = new Uint32Array(256), count = image?.width * image?.height;
    if (!image?.data || !count) return 155;
    for (let i = 0; i < image.data.length; i += 4) {
      const gray = Math.max(0, Math.min(255, Math.round(
        image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114,
      )));
      histogram[gray]++;
    }
    let total = 0;
    for (let value = 0; value < 256; value++) total += value * histogram[value];
    let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 155;
    for (let value = 0; value < 256; value++) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = count - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const difference = backgroundSum / backgroundWeight - (total - backgroundSum) / foregroundWeight,
        variance = backgroundWeight * foregroundWeight * difference * difference;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = value;
      }
    }
    return Math.max(96, Math.min(210, threshold));
  }
  function isMesoField(image) {
    let light = 0,
      ink = 0;
    const count = image?.width * image?.height;
    if (!image?.data || !count) return false;
    for (let i = 0; i < image.data.length; i += 4) {
      const gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
      if (gray > 180) light++;
      if (gray < 90) ink++;
    }
    return light / count >= 0.4 && ink / count >= 0.02 && ink / count <= 0.45;
  }
  function reducedGray(image) {
    const factor = Math.max(1, image.width / 640, image.height / 360),
      width = Math.max(1, Math.floor(image.width / factor)),
      height = Math.max(1, Math.floor(image.height / factor)),
      gray = new Uint8Array(width * height),
      sx = image.width / width,
      sy = image.height / height;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const x0 = Math.floor(x * sx),
          y0 = Math.floor(y * sy),
          x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) * sx))),
          y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
        let total = 0,
          count = 0;
        for (let py = y0; py < y1; py++)
          for (let px = x0; px < x1; px++) {
            const i = (py * image.width + px) * 4;
            total += image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
            count++;
          }
        gray[y * width + x] = Math.round(total / count);
      }
    return { gray, width, height, sx, sy };
  }
  function createMesoAnchor(image, region, border = null) {
    if (!image?.data || !region) return null;
    const reduced = reducedGray(image),
      ax = Math.max(0, Math.round(region.x * reduced.width)),
      ay = Math.max(0, Math.round(region.y * reduced.height)),
      aw = Math.max(2, Math.round(region.w * reduced.width)),
      ah = Math.max(2, Math.round(region.h * reduced.height)),
      left = Math.max(10, Math.round(ah * 3)),
      right = Math.max(20, Math.round(ah * 4)),
      top = Math.max(3, Math.round(ah * 0.7)),
      bottom = top,
      x0 = Math.max(0, ax - left),
      y0 = Math.max(0, ay - top),
      x1 = Math.min(reduced.width, ax + aw + right),
      y1 = Math.min(reduced.height, ay + ah + bottom),
      amount = { x: ax - x0, y: ay - y0, w: aw, h: ah },
      width = x1 - x0,
      height = y1 - y0,
      features = [],
      add = (x, y) => {
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return;
        const px = x + x0,
          py = y + y0,
          index = py * reduced.width + px,
          value = reduced.gray[index],
          edge = Math.max(
            Math.abs(value - reduced.gray[index - 1]),
            Math.abs(value - reduced.gray[index + 1]),
            Math.abs(value - reduced.gray[index - reduced.width]),
            Math.abs(value - reduced.gray[index + reduced.width]),
          );
        if (edge >= 10) features.push([x, y, value]);
      };
    // Static coin and MESOS label identify the inventory row. The amount itself
    // is masked; only the textbox outline is included so changing digits cannot
    // break alignment.
    for (let y = 1; y < height - 1; y += 2)
      for (let x = 1; x < amount.x - 1; x += 2) add(x, y);
    for (let y = 1; y < height - 1; y += 2)
      for (let x = amount.x + amount.w + 1; x < width - 1; x += 2) add(x, y);
    const topY = amount.y - 1,
      bottomY = amount.y + amount.h;
    for (let x = amount.x; x < amount.x + amount.w; x += 4) {
      add(x, topY);
      add(x, bottomY);
    }
    for (let y = amount.y; y < amount.y + amount.h; y += 2) {
      add(amount.x, y);
      add(amount.x + amount.w - 1, y);
    }
    if (border) {
      const bx = ax + Math.round(border.x * aw),
        by = ay + Math.round(border.y * ah),
        bw = Math.max(2, Math.round(border.w * aw)),
        bh = Math.max(2, Math.round(border.h * ah));
      for (let x = bx; x < bx + bw; x += 2) {
        add(x, by);
        add(x, by + bh - 1);
      }
      for (let y = by; y < by + bh; y += 2) {
        add(bx, y);
        add(bx + bw - 1, y);
      }
    }
    if (features.length < 30) return null;
    const sourceAx = Math.max(0, Math.round(region.x * image.width)),
      sourceAy = Math.max(0, Math.round(region.y * image.height)),
      sourceAw = Math.max(2, Math.round(region.w * image.width)),
      sourceAh = Math.max(2, Math.round(region.h * image.height)),
      sourceLeft = Math.max(20, Math.round(sourceAh * 3)),
      sourceRight = Math.max(40, Math.round(sourceAh * 4)),
      sourceTop = Math.max(8, Math.round(sourceAh * 0.7)),
      sourceX0 = Math.max(0, sourceAx - sourceLeft),
      sourceY0 = Math.max(0, sourceAy - sourceTop),
      sourceX1 = Math.min(image.width, sourceAx + sourceAw + sourceRight),
      sourceY1 = Math.min(image.height, sourceAy + sourceAh + sourceTop),
      full = {
        width: sourceX1 - sourceX0,
        height: sourceY1 - sourceY0,
        amount: {
          x: sourceAx - sourceX0,
          y: sourceAy - sourceY0,
          w: sourceAw,
          h: sourceAh,
        },
        features: [],
      },
      pixelGray = (x, y) => {
        const i = (y * image.width + x) * 4;
        return Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
      },
      fullAdd = (x, y) => {
        if (x < 1 || y < 1 || x >= full.width - 1 || y >= full.height - 1) return;
        const px = x + sourceX0,
          py = y + sourceY0,
          value = pixelGray(px, py),
          edge = Math.max(
            Math.abs(value - pixelGray(px - 1, py)),
            Math.abs(value - pixelGray(px + 1, py)),
            Math.abs(value - pixelGray(px, py - 1)),
            Math.abs(value - pixelGray(px, py + 1)),
          );
        if (edge >= 10) full.features.push([x, y, value]);
      };
    for (let y = 2; y < full.height - 2; y += 3) {
      for (let x = 2; x < full.amount.x - 2; x += 3) fullAdd(x, y);
      for (let x = full.amount.x + full.amount.w + 2; x < full.width - 2; x += 3) fullAdd(x, y);
    }
    for (let x = full.amount.x; x < full.amount.x + full.amount.w; x += 8) {
      fullAdd(x, full.amount.y - 1);
      fullAdd(x, full.amount.y + full.amount.h);
    }
    if (border) {
      const bx = full.amount.x + Math.round(border.x * full.amount.w),
        by = full.amount.y + Math.round(border.y * full.amount.h),
        bw = Math.max(2, Math.round(border.w * full.amount.w)),
        bh = Math.max(2, Math.round(border.h * full.amount.h));
      for (let x = bx; x < bx + bw; x += 2) {
        fullAdd(x, by);
        fullAdd(x, by + bh - 1);
      }
      for (let y = by; y < by + bh; y += 2) {
        fullAdd(bx, y);
        fullAdd(bx + bw - 1, y);
      }
    }
    if (full.features.length < 30) return null;
    return { version: 3, width, height, amount, features, full };
  }
  function locateMesoAnchor(image, anchor, previousRegion = null) {
    if (!image?.data || anchor?.version !== 3 || !anchor?.features?.length) return null;
    const full = anchor.full;
    if (previousRegion && full?.features?.length) {
      const scale = (previousRegion.w * image.width) / full.amount.w,
        expectedX = previousRegion.x * image.width - full.amount.x * scale,
        expectedY = previousRegion.y * image.height - full.amount.y * scale,
        radiusX = 18,
        radiusY = 14;
      let best = null;
      for (let y = Math.max(0, Math.round(expectedY) - radiusY); y <= Math.min(image.height - full.height * scale, Math.round(expectedY) + radiusY); y += 2)
        for (let x = Math.max(0, Math.round(expectedX) - radiusX); x <= Math.min(image.width - full.width * scale, Math.round(expectedX) + radiusX); x += 2) {
          let error = 0,
            aborted = false;
          const cutoff = (best?.score ?? 20) * full.features.length;
          for (const [fx, fy, value] of full.features) {
            const tx = x + Math.round(fx * scale),
              ty = y + Math.round(fy * scale),
              i = (ty * image.width + tx) * 4,
              gray = Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
            error += Math.abs(gray - value);
            if (error > cutoff) {
              aborted = true;
              break;
            }
          }
          if (aborted) continue;
          const score = error / full.features.length;
          if (!best || score < best.score) best = { x, y, scale, score };
        }
      if (best?.score <= 20) {
        const x = best.x + full.amount.x * best.scale,
          y = best.y + full.amount.y * best.scale,
          w = full.amount.w * best.scale,
          h = full.amount.h * best.scale;
        return {
          region: { x: x / image.width, y: y / image.height, w: w / image.width, h: h / image.height },
          score: best.score,
          scale: best.scale,
        };
      }
    }
    const target = reducedGray(image),
      scales = [1, 0.95, 1.08, 0.85, 0.72, 1.22, 1.38],
      candidates = [];
    for (const scale of scales) {
      const features = anchor.features.map(([x, y, value]) => [Math.round(x * scale), Math.round(y * scale), value]),
        maxX = Math.round(anchor.width * scale),
        maxY = Math.round(anchor.height * scale),
        findTop = (fromX, toX, fromY, toY, step, limit = 6) => {
          const top = [];
          for (let y = fromY; y <= toY && y + maxY <= target.height; y += step)
            for (let x = fromX; x <= toX && x + maxX <= target.width; x += step) {
              let error = 0,
                aborted = false;
              const cutoff = (top.length === limit ? top.at(-1).score : 30) * features.length;
              for (const [fx, fy, value] of features) {
                error += Math.abs(target.gray[(y + fy) * target.width + x + fx] - value);
                if (error > cutoff) {
                  aborted = true;
                  break;
                }
              }
              if (aborted) continue;
              const score = error / features.length;
              if (score > (top.length === limit ? top.at(-1).score : 30)) continue;
              const item = { x, y, scale, score },
                near = top.findIndex((c) => Math.hypot(c.x - x, c.y - y) <= 5);
              if (near >= 0) {
                if (score >= top[near].score) continue;
                top.splice(near, 1);
              }
              top.push(item);
              top.sort((a, b) => a.score - b.score);
              if (top.length > limit) top.pop();
            }
          return top;
        },
        seeds = findTop(0, target.width - maxX, 0, target.height - maxY, scale === 1 ? 1 : 3),
        refined = seeds.map((seed) => {
          let best = seed;
          for (let y = Math.max(0, seed.y - 3); y <= Math.min(target.height - maxY, seed.y + 3); y++)
            for (let x = Math.max(0, seed.x - 3); x <= Math.min(target.width - maxX, seed.x + 3); x++) {
              let error = 0;
              for (const [fx, fy, value] of features) {
                error += Math.abs(target.gray[(y + fy) * target.width + x + fx] - value);
                if (error > best.score * features.length) break;
              }
              const score = error / features.length;
              if (score < best.score) best = { x, y, scale, score };
            }
          return best;
        });
      if (scale === 1 && refined[0]?.score <= 2) {
        const exact = refined[0],
          x = (exact.x + anchor.amount.x * exact.scale) * target.sx,
          y = (exact.y + anchor.amount.y * exact.scale) * target.sy,
          w = anchor.amount.w * exact.scale * target.sx,
          h = anchor.amount.h * exact.scale * target.sy;
        return {
          region: { x: x / image.width, y: y / image.height, w: w / image.width, h: h / image.height },
          score: exact.score,
          scale: exact.scale,
        };
      }
      candidates.push(...refined);
    }
    candidates.sort((a, b) => a.score - b.score);
    const coarseBest = candidates[0];
    if (!coarseBest || coarseBest.score > 30) return null;
    if (!anchor.full?.features?.length)
      return null;
    const seeds = [];
    for (const candidate of candidates) {
      const x = candidate.x * target.sx,
        y = candidate.y * target.sy;
      if (seeds.some((c) => Math.hypot(c.x - x, c.y - y) < 18)) continue;
      seeds.push({ ...candidate, sourceX: x, sourceY: y });
      if (seeds.length >= 12) break;
    }
    const refined = [];
    for (const seed of seeds) {
      for (const scale of [Math.max(0.5, seed.scale - 0.05), seed.scale, seed.scale + 0.05]) {
        const width = Math.round(full.width * scale),
          height = Math.round(full.height * scale),
          centerX = Math.round(seed.sourceX),
          centerY = Math.round(seed.sourceY),
          radius = Math.max(24, Math.ceil(Math.max(target.sx, target.sy) * 8)),
          fromX = Math.max(0, centerX - radius),
          toX = Math.min(image.width - width, centerX + radius),
          fromY = Math.max(0, centerY - radius),
          toY = Math.min(image.height - height, centerY + radius);
        let best = null;
        for (let y = fromY; y <= toY; y += 2)
          for (let x = fromX; x <= toX; x += 2) {
            let error = 0,
              aborted = false;
            const cutoff = (best?.score ?? 30) * full.features.length;
            for (const [fx, fy, value] of full.features) {
              const tx = x + Math.round(fx * scale),
                ty = y + Math.round(fy * scale),
                i = (ty * image.width + tx) * 4,
                gray = Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
              error += Math.abs(gray - value);
              if (error > cutoff) {
                aborted = true;
                break;
              }
            }
            if (aborted) continue;
            const score = error / full.features.length;
            if (!best || score < best.score) best = { x, y, scale, score };
          }
        if (best) refined.push(best);
      }
    }
    refined.sort((a, b) => a.score - b.score);
    const best = refined[0];
    if (!best || best.score > 30) return null;
    const bestX = best.x + full.amount.x * best.scale,
      bestY = best.y + full.amount.y * best.scale,
      other = refined.find((c) =>
        Math.hypot(
          c.x + full.amount.x * c.scale - bestX,
          c.y + full.amount.y * c.scale - bestY,
        ) > Math.max(12, best.scale * 8),
      );
    if (other && other.score - best.score < 3) return null;
    const x = best.x + full.amount.x * best.scale,
      y = best.y + full.amount.y * best.scale,
      w = full.amount.w * best.scale,
      h = full.amount.h * best.scale;
    return {
      region: { x: x / image.width, y: y / image.height, w: w / image.width, h: h / image.height },
      score: best.score,
      scale: best.scale,
    };
  }
  function recognizeMesoDigits(image) {
    if (!image?.data || image.width < 10 || image.height < 10) return null;
    const width = image.width, height = image.height,
      ink = new Uint8Array(width * height), visited = new Uint8Array(width * height),
      templates = [
        [[".###.", "#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]],
        [["..#..", "###..", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"]],
        [[".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#....", "#####"]],
        [[".###.", "#...#", "....#", "..##.", "....#", "....#", "#...#", ".###."]],
        [["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#.", "...#."]],
        [["#####", "#....", "#....", "####.", "....#", "....#", "#...#", ".###."]],
        [["..##.", ".#...", "#....", "####.", "#...#", "#...#", "#...#", ".###."]],
        [["#####", "....#", "...#.", "...#.", "..#..", "..#..", ".#...", ".#..."]],
        [[".###.", "#...#", "#...#", ".###.", "#...#", "#...#", "#...#", ".###."]],
        [[".###.", "#...#", "#...#", "#...#", ".####", "....#", "...#.", ".##.."]],
      ];
    for (let y = 2; y < height - 2; y++)
      for (let x = 2; x < width - 2; x++) {
        const i = (y * width + x) * 4,
          gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
        if (gray < 150) ink[y * width + x] = 1;
      }
    const glyphs = [], separators = [];
    for (let y = 2; y < height - 2; y++)
      for (let x = 2; x < width - 2; x++) {
        const start = y * width + x;
        if (!ink[start] || visited[start]) continue;
        const queue = [start];
        visited[start] = 1;
        let minX = x, maxX = x, minY = y, maxY = y;
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const index = queue[cursor], px = index % width, py = (index / width) | 0;
          minX = Math.min(minX, px); maxX = Math.max(maxX, px);
          minY = Math.min(minY, py); maxY = Math.max(maxY, py);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = px + dx, ny = py + dy, next = ny * width + nx;
              if (nx >= 2 && ny >= 2 && nx < width - 2 && ny < height - 2 && ink[next] && !visited[next]) {
                visited[next] = 1;
                queue.push(next);
              }
            }
        }
        const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
        if (boxWidth >= 2 && boxWidth <= 8 && boxHeight >= 7 && boxHeight <= 10 && queue.length >= 8)
          glyphs.push({ x: minX, y: minY, width: boxWidth, height: boxHeight });
        else if (boxWidth >= 1 && boxWidth <= 4 && boxHeight >= 2 && boxHeight <= 6 && queue.length >= 2)
          separators.push({ x: minX, y: minY, width: boxWidth, height: boxHeight });
      }
    if (glyphs.length < 1 || glyphs.length > 10) return null;
    glyphs.sort((a, b) => a.x - b.x);
    separators.sort((a, b) => a.x - b.x);
    const expectedSeparators = Math.floor((glyphs.length - 1) / 3);
    if (separators.length !== expectedSeparators) return null;
    for (let i = 0; i < separators.length; i++) {
      const digitsBeforeSeparator = glyphs.length - (separators.length - i) * 3,
        previous = glyphs[digitsBeforeSeparator - 1],
        next = glyphs[digitsBeforeSeparator],
        separator = separators[i];
      if (!previous || !next || separator.x <= previous.x + previous.width - 1 || separator.x + separator.width > next.x)
        return null;
    }
    let digits = "", confidence = 100;
    for (const glyph of glyphs) {
      const scores = templates.map((variants, digit) => {
        let best = 40;
        for (const template of variants) {
          let mismatches = 0;
          for (let row = 0; row < 8; row++)
            for (let column = 0; column < 5; column++) {
              const x = glyph.x + Math.min(glyph.width - 1, Math.floor((column + 0.5) * glyph.width / 5)),
                y = glyph.y + Math.min(glyph.height - 1, Math.floor((row + 0.5) * glyph.height / 8)),
                actual = ink[y * width + x] ? "#" : ".";
              if (actual !== template[row][column]) mismatches++;
            }
          best = Math.min(best, mismatches);
        }
        return { digit, mismatches: best };
      }).sort((a, b) => a.mismatches - b.mismatches);
      if (scores[0].mismatches > 2 || scores[1].mismatches - scores[0].mismatches < 2) return null;
      digits += scores[0].digit;
      confidence = Math.min(confidence, Math.round((1 - scores[0].mismatches / 40) * 100));
    }
    if (digits.length > 1 && digits[0] === "0") return null;
    const amount = Number(digits);
    return Number.isSafeInteger(amount) && amount <= 2147483647 ? { amount, confidence } : null;
  }
  async function readMesoAmount(image, recognize) {
    if (!isMesoField(image)) return null;
    const results = [];
    for (const [threshold, kind] of [[null, "meso-value"], [155, "meso-value-binary"]]) {
      const pixels = prepareMeso(image, threshold),
        reading = await recognize(pixels, kind),
        amount = parseMeso(reading.text);
      if (amount !== null && reading.confidence >= 40)
        results.push({ amount, confidence: reading.confidence });
    }
    if (results.length === 2 && results[0].amount === results[1].amount)
      return { amount: results[0].amount, confidence: Math.round(Math.min(results[0].confidence, results[1].confidence)) };
    const adaptive = await recognize(prepareMeso(image, mesoAdaptiveThreshold(image)), "meso-value-adaptive"),
      adaptiveAmount = parseMeso(adaptive.text);
    if (adaptiveAmount !== null && adaptive.confidence >= 40)
      results.push({ amount: adaptiveAmount, confidence: adaptive.confidence });
    const votes = new Map();
    for (const result of results) {
      const group = votes.get(result.amount) || [];
      group.push(result.confidence);
      votes.set(result.amount, group);
    }
    const winner = [...votes.entries()].filter(([, confidences]) => confidences.length >= 2);
    if (winner.length === 1)
      return { amount: winner[0][0], confidence: Math.round(Math.min(...winner[0][1])) };
    // Short balances can be too small for Tesseract to segment. Use verified
    // Maple Classic glyphs only when OCR produced no usable candidate; reject
    // unknown/ambiguous shapes and preserve the game's signed 32-bit ceiling.
    return results.length === 0 ? recognizeMesoDigits(image) : null;
  }
  function choose(readings, kind, native) {
    const valid = readings
      .map((r) => ({ ...r, text: normalize(r.text, kind) }))
      .filter((r) => r.text && r.confidence >= (kind === "level" ? 35 : 0));
    if (kind === "level") {
      const digits = native?.expectedDigits;
      if (digits)
        for (let i = valid.length - 1; i >= 0; i--)
          if (valid[i].text.length !== digits) valid.splice(i, 1);
      // A neural confidence score cannot overrule a clear digit or near-exact shape.
      if (native?.details)
        for (let i = valid.length - 1; i >= 0; i--)
          if (
            native.details.some(
              (d, k) =>
                (/^\d$/.test(d.text || "") && d.text !== valid[i].text[k]) ||
                (d.error < 0.025 &&
                  d.margin > 0.01 &&
                  d.best !== valid[i].text[k]),
            )
          )
            valid.splice(i, 1);
    }
    if (kind === "exp" && native?.text) {
      const percentageOnly = native.text.startsWith("[");
      for (let i = valid.length - 1; i >= 0; i--)
        if (valid[i].text.startsWith("[") !== percentageOnly)
          valid.splice(i, 1);
    }
    // A clear native level independently constrains full-field neural readings.
    // Conflicting candidates are removed only by the existing rounded EXP math;
    // acceptance still needs two matching preprocessing results.
    if (
      kind === "exp" &&
      Number.isFinite(native?.requiredExp) &&
      native.requiredExp > 0
    )
      for (let i = valid.length - 1; i >= 0; i--) {
        const m = valid[i].text.match(/^(\d[\d.]*)\[(\d+\.\d{2})%\]$/);
        if (m) {
          const amount = Number(m[1].replace(/\./g, "")),
            pct = Number(m[2]);
          if (
            amount > native.requiredExp ||
            Math.abs((amount / native.requiredExp) * 100 - pct) > 0.03
          )
            valid.splice(i, 1);
        }
      }
    const groups = new Map();
    for (const r of valid) {
      const g = groups.get(r.text) || [];
      g.push(r);
      groups.set(r.text, g);
    }
    if (groups.size !== 1) return null;
    const [text, votes] = [...groups][0],
      confidence = Math.max(...votes.map((v) => v.confidence));
    const corroborated =
      kind === "level" &&
      native?.details?.length === text.length &&
      native.details.every(
        (d, i) =>
          (d.text === text[i] || d.best === text[i]) &&
          d.error < 0.06 &&
          d.margin > 0.008,
      );
    if (
      kind === "level" &&
      confidence < 60 &&
      votes.length < 2 &&
      !corroborated
    )
      return null;
    if (kind === "exp" && (votes.length < 2 || confidence < 30)) return null;
    return { text, confidence, engine: "tesseract", votes: votes.length };
  }
  function createReader(recognize) {
    let queue = Promise.resolve();
    const cache = new Map();
    function read(input) {
      const task = queue.then(async () => {
        const result = {};
        if (input.mapImage) {
          try {
            const mapPixels = MapName.prepare(input.mapImage),
              reading = await recognize(mapPixels, "map");
            result.map = MapName.parse(reading?.text, reading?.confidence);
            // Full-block OCR can merge the two tiny pixel-font lines. When it
            // cannot canonicalize a result, OCR each detected line separately
            // with single-line segmentation before falling back to raw text.
            if (!result.map?.canonicalized) {
              const lines = MapName.splitLabelLines(input.mapImage);
              const originalLines = String(reading?.text || "")
                .replace(/\r/g, "")
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length >= 3 && /[A-Za-z]{3}/.test(line));
              let fullStreet = originalLines[0];
              if (lines.length === 2) {
                // The Tesseract worker is shared and its parameters change per
                // request, so keep these reads sequential to avoid PSM races.
                const street = await recognize(
                    MapName.prepare(lines[0], 6),
                    "map-line",
                  ),
                  name = await recognize(
                    MapName.prepare(lines[1], 6),
                    "map-line",
                  );
                const confidence = Math.min(
                  street?.confidence ?? 0,
                  name?.confidence ?? 0,
                );
                fullStreet ||= String(street?.text || "")
                  .replace(/\r/g, "")
                  .split("\n")
                  .map((line) => line.trim())
                  .find((line) => line.length >= 3 && /[A-Za-z]{3}/.test(line));
                const corrected = [
                    MapName.parse(
                      `${street?.text || ""}\n${name?.text || ""}`,
                      confidence,
                    ),
                    // Sometimes block segmentation reads the street cleanly
                    // while the isolated second line reads the map name more
                    // clearly. Combining those independent OCR readings helps
                    // without relaxing the parser's canonical-match checks.
                    MapName.parse(
                      `${fullStreet || ""}\n${name?.text || ""}`,
                      Math.min(reading?.confidence ?? 0, name?.confidence ?? 0),
                    ),
                  ].find((candidate) => candidate?.canonicalized);
                if (corrected) result.map = corrected;
              }
              if (!result.map?.canonicalized) {
                // The compact pixel font can merge letters at the standard
                // scale. Retry one alternate scale and combine only its map
                // line with the independently recognized street anchor.
                // canonicalMap still requires a unique lexicon match.
                const alternate = await recognize(
                    MapName.prepare(input.mapImage, 5),
                    "map",
                  ),
                  alternateLines = String(alternate?.text || "")
                    .replace(/\r/g, "")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length >= 3 && /[A-Za-z]{3}/.test(line)),
                  streetLine = fullStreet || alternateLines[0],
                  alternateLine = alternateLines[1],
                  alternateCorrection =
                    streetLine && alternateLine
                      ? MapName.parse(
                          `${streetLine}\n${alternateLine}`,
                          fullStreet
                            ? Math.min(
                                reading?.confidence ?? 0,
                                alternate?.confidence ?? 0,
                              )
                            : alternate?.confidence,
                        )
                      : null;
                if (alternateCorrection?.canonicalized)
                  result.map = alternateCorrection;
              }
              if (!result.map?.canonicalized) {
                // Dimmed captures can leave the map text below the grayscale
                // engine's contrast range. Try a text-area-only Otsu threshold
                // and accept only a unique canonical map-list result.
                const thresholded = await recognize(
                    MapName.prepareThreshold(input.mapImage, 4),
                    "map",
                  ),
                  thresholdedMap = MapName.parse(
                    thresholded?.text,
                    thresholded?.confidence,
                  );
                if (thresholdedMap?.canonicalized)
                  result.map = thresholdedMap;
              }
            }
          } catch {
            // Map-name OCR is optional and independent of progression OCR.
            result.map = null;
          }
        }
        for (const kind of ["level", "exp"]) {
          const native = kind === "level" ? input.nativeLevel : input.nativeExp;
          const prefix =
            kind === "exp" ? input.nativeExp?.text?.split("[")[0] : "";
          if (kind === "level" && /^\d{1,3}$/.test(native?.data?.text || ""))
            continue;
          if (
            kind === "exp" &&
            (normalize(input.nativeExp?.text || "", kind) ||
              !input.nativeExp?.text?.includes("["))
          )
            continue;
          const image = kind === "level" ? input.levelImage : input.expImage;
          if (!image) continue;
          const context =
            kind === "exp" &&
            prefix &&
            (!/^\d[\d.]*$/.test(prefix) ||
              (input.requiredExp > 0 && native.text.includes("?")));
          let hash = 2166136261;
          for (const v of image.data) hash = Math.imul(hash ^ v, 16777619);
          const key =
            kind +
            (context ? "-context" : "") +
            ":" +
            image.width +
            ":" +
            image.height +
            ":" +
            hash;
          let readings = cache.get(key);
          if (!readings) {
            readings = [];
            for (const mode of kind === "level"
              ? ["soft", "blue"]
              : ["soft", "large"]) {
              const pixels = prepare(
                image,
                context ? "exp-context" : kind,
                mode,
              );
              if (pixels) {
                let reading = await recognize(pixels, kind);
                if (context) {
                  const fields = reading.text
                    .trim()
                    .match(/^(\d[\d.,]*)\s+(\d{1,3}\.\d{2})%$/);
                  reading = {
                    ...reading,
                    text: fields
                      ? fields[1].replace(/,/g, ".") + "[" + fields[2] + "%]"
                      : "",
                  };
                }
                readings.push(reading);
              }
            }
            cache.set(key, readings);
            if (cache.size > 12) cache.delete(cache.keys().next().value);
          }
          const evidence =
            kind === "exp"
              ? {
                  text: context ? native.text : "[",
                  requiredExp: input.requiredExp,
                }
              : native;
          let chosen = choose(readings, kind, evidence);
          if (
            !chosen &&
            context &&
            Number.isFinite(input.requiredExp) &&
            input.requiredExp > 0 &&
            readings.length === 2
          ) {
            const pixels = prepare(image, "exp-context", "binary");
            if (pixels) {
              let reading = await recognize(pixels, kind);
              const fields = reading.text
                .trim()
                .match(/^(\d[\d.,]*)\s+(\d{1,3}\.\d{2})%$/);
              reading = {
                ...reading,
                text: fields
                  ? fields[1].replace(/,/g, ".") + "[" + fields[2] + "%]"
                  : "",
              };
              readings.push(reading);
              cache.set(key, readings);
              chosen = choose(readings, kind, evidence);
            }
          }
          result[kind] = chosen;
          if (kind === "exp" && result[kind] && prefix && !context)
            result[kind] = {
              ...result[kind],
              text: prefix + result[kind].text,
              confidence: Math.min(
                result[kind].confidence,
                input.nativeExp.confidence || 0,
              ),
            };
        }
        if (input.mesoImage) {
          result.mesoPreview = prepareMeso(input.mesoImage);
          try {
            result.meso = await readMesoAmount(input.mesoImage, recognize);
          } catch {
            // Meso reading is independent of level and EXP recognition.
            result.meso = null;
          }
        }
        if (input.mesoScanImage) {
          try {
            let candidateImage = null;
            const onPreview = (image) => {
              candidateImage = image;
              try { input.onMesoPreview?.(prepareMeso(image)); } catch {}
            };
            const field = (input.mesoReference && locateMesoReference(input.mesoScanImage, input.mesoReference, onPreview)) ||
              await locateMesoField(input.mesoScanImage, recognize, onPreview);
            result.mesoPreview = prepareMeso(field?.amountImage || candidateImage);
            if (field) {
              result.mesoCandidate = { region: field.region, border: field.border || null };
              const meso = await readMesoAmount(field.amountImage, recognize);
              result.meso = meso ? { ...meso, region: field.region, border: field.border } : null;
            } else result.meso = null;
          } catch {
            result.meso = null;
          }
        }
        return result;
      });
      queue = task.catch(() => {});
      return task;
    }
    return { read };
  }
  let browserReader;
  function read(input) {
    if (!browserReader) {
      let workerPromise, configuredWorker, configuredKind;
      const worker = async () => {
        if (!workerPromise)
          workerPromise = (async () => {
            if (typeof Tesseract === "undefined")
              await new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = new URL(
                  "assets/ocr/tesseract.min.js",
                  location.href,
                ).href;
                s.onload = resolve;
                s.onerror = () =>
                  reject(Error("Local OCR runtime could not load"));
                document.head.appendChild(s);
              });
            const base = new URL("assets/ocr/", location.href).href;
            return Tesseract.createWorker("eng", 1, {
              workerPath: base + "worker.min.js",
              corePath: base,
              langPath: base,
              gzip: true,
              cachePath: "maple-track-eng-5dc5d8d6",
            });
          })().catch((e) => {
            workerPromise = null;
            throw e;
          });
        return workerPromise;
      };
      browserReader = createReader(async (pixels, kind) => {
        const w = await worker();
        if (configuredWorker !== w || configuredKind !== kind) {
          await w.setParameters({
            tessedit_pageseg_mode:
              kind === "meso-scan" ? 11 : kind === "map" ? 6 : 7,
            tessedit_char_whitelist:
              kind === "meso-scan"
                ? "0123456789,.MESOS"
                : kind === "map" || kind === "map-line"
                ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-'(),.0123456789 "
                : kind === "level"
                ? "LV.0123456789"
                : kind.startsWith("meso-value")
                    ? "0123456789,."
                    : "0123456789.[]% ",
          });
          configuredWorker = w;
          configuredKind = kind;
        }
        const c = document.createElement("canvas");
        c.width = pixels.width;
        c.height = pixels.height;
        c.getContext("2d").putImageData(
          new ImageData(pixels.data, pixels.width, pixels.height),
          0,
          0,
        );
        try {
          const { data } = await w.recognize(c);
          return { text: data.text, confidence: data.confidence, words: data.words || [] };
        } finally {
          c.width = 0;
          c.height = 0;
        }
      });
    }
    return browserReader.read(input);
  }
  return { prepare, normalize, choose, parseMeso, prepareMeso, isMesoField, scaleMesoScan, createMesoReference, locateMesoReference, loadMesoReference, locateMesoField, createMesoAnchor, locateMesoAnchor, recognizeMesoDigits, readMesoAmount, createReader, read };
});
