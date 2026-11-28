(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapleSession = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const required = (l) => {
    if (!Number.isInteger(l) || l < 1 || l > 99) return 0;
    if (l <= 5) return (Math.floor((l * l) / 2) + 15) * l;
    if (l <= 50) {
      const q = Math.floor((l * l) / 3);
      return (q + 19) * q;
    }
    if (l <= 89) return Math.floor((required(l - 1) * 10548) / 10000);
    return Math.floor((required(l - 1) * 21) / 10);
  };
  const levelStartExp = (l) => {
    let total = 0;
    for (let n = 1; n < l; n++) total += required(n);
    return total;
  };
  const totalExp = (s) => levelStartExp(s.level) + (s.exp || 0);
  function parseHudReading(levelText, expText) {
    const levelMatch =
      levelText.match(/\bLV\s*\.?\s*(\d{1,3})\b/i) ||
      levelText.trim().match(/^(\d{1,3})$/);
    const pctMatch = expText.match(/(\d+(?:\.\d+)?)\s*%/);
    const normalized = expText.replace(/\bEXP\s*[.:]?/gi, " ").trim();
    // Read the amount before the percentage; OCR often drops a closing bracket.
    const amountText = normalized
      .split(/[\[(]/, 1)[0]
      .replace(/\d+(?:\.\d+)?\s*%\s*[\])]?\s*$/, " ")
      .trim();
    const amountMatch = amountText.match(
      /^(\d{1,3}(?:\s*[,.]\s*\d{3})+|\d+)\s*[\])]?\s*$/,
    );
    return {
      levelMatch: levelMatch ? [levelMatch[1]] : null,
      expToken: amountMatch?.[1]?.replace(/\s/g, "").replace(/\./g, ","),
      pctToken: pctMatch?.[1],
    };
  }

  function create({
    storage,
    key = "maple-track-v1",
    levelOcr,
    isCanonicalMapName = () => true,
    isValidDropNotice = () => false,
    now = Date.now,
    onChange = () => {},
  } = {}) {
    const SCHEMA_VERSION = 1,
      UPDATABLE_FIELDS = new Set([
        "running", "paused", "source", "startAt", "endAt", "mesoRegion", "mesoAnchor", "mesoStatus", "calibration",
      ]),
      validTime = (value) => Number.isFinite(value) && value >= 0,
      validRegion = (value) =>
        value &&
        [value.x, value.y, value.w, value.h].every(Number.isFinite) &&
        value.x >= 0 && value.y >= 0 && value.w > 0 && value.h > 0 &&
        value.x + value.w <= 1.001 && value.y + value.h <= 1.001
          ? { x: value.x, y: value.y, w: value.w, h: value.h }
          : null;
    const defaults = {
      schemaVersion: SCHEMA_VERSION,
      samples: [],
      mesoSamples: [],
      mesoStartAmount: null,
      mesoStatus: "Searching for the inventory balance automatically",
      dropNotices: [],
      mapName: "",
      mapUpdatedAt: null,
      mapHistory: [],
      level: null,
      source: null,
      running: false,
      startAt: null,
      endAt: null,
      calibration: { level: null, exp: null, auto: true },
    };
    let saved = {};
    try {
      saved = JSON.parse(storage?.getItem(key) || "{}") || {};
    } catch {}
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
    const state = {
      ...defaults,
      ...saved,
      running: false,
      source: null,
      paused: false,
    };
    state.schemaVersion = SCHEMA_VERSION;
    state.samples = Array.isArray(state.samples)
      ? state.samples
          .filter((sample) =>
            validTime(sample?.t) &&
            Number.isInteger(sample.level) && sample.level >= 1 && sample.level <= 100 &&
            Number.isFinite(sample.exp) && sample.exp >= 0,
          )
          .map((sample) => ({
            t: sample.t,
            level: sample.level,
            exp: sample.exp,
            ...(sample.estimated === true
              ? { estimated: true, ...(Number.isFinite(sample.pct) ? { pct: sample.pct } : {}) }
              : {}),
          }))
          .sort((a, b) => a.t - b.t)
          .slice(-240)
      : [];
    state.mesoSamples = Array.isArray(state.mesoSamples)
      ? state.mesoSamples
          .filter((sample) => validTime(sample?.t) && Number.isSafeInteger(sample.amount) && sample.amount >= 0)
          .map((sample) => ({ t: sample.t, amount: sample.amount }))
          .sort((a, b) => a.t - b.t)
          .slice(-720)
      : [];
    state.level = Number.isInteger(state.level) && state.level >= 1 && state.level <= 100
      ? state.level
      : null;
    state.startAt = validTime(state.startAt) ? state.startAt : null;
    state.endAt = validTime(state.endAt) ? state.endAt : null;
    state.mapUpdatedAt = validTime(state.mapUpdatedAt) ? state.mapUpdatedAt : null;
    state.mapName = typeof state.mapName === "string" ? state.mapName.trim() : "";
    state.mesoStatus = typeof state.mesoStatus === "string"
      ? state.mesoStatus.slice(0, 180)
      : defaults.mesoStatus;
    state.mesoRegion = validRegion(state.mesoRegion);
    if (!state.mesoRegion || !state.mesoAnchor || typeof state.mesoAnchor !== "object" || Array.isArray(state.mesoAnchor))
      state.mesoAnchor = null;
    state.calibration = {
      level: validRegion(state.calibration?.level),
      exp: validRegion(state.calibration?.exp),
      auto: state.calibration?.auto !== false,
    };
    state.mapHistory = Array.isArray(state.mapHistory)
      ? state.mapHistory
          .filter((entry) => (typeof entry?.name === "string" || entry?.name === null) && Number.isFinite(entry.t))
          .map((entry) => ({
            t: entry.t,
            name: typeof entry.name === "string" && isCanonicalMapName(entry.name.trim())
              ? entry.name.trim()
              : null,
          }))
          .sort((a, b) => a.t - b.t)
          .slice(-1000)
      : [];
    if (state.mapName && !isCanonicalMapName(state.mapName)) {
      state.mapName = "";
      if (Number.isFinite(state.mapUpdatedAt) && !state.mapHistory.some((entry) => entry.t === state.mapUpdatedAt && entry.name === null))
        state.mapHistory.push({ t: state.mapUpdatedAt, name: null });
    }
    if (!state.mapHistory.length && state.mapName && Number.isFinite(state.mapUpdatedAt))
      state.mapHistory.push({ t: state.mapUpdatedAt, name: state.mapName });
    state.dropNotices = Array.isArray(state.dropNotices)
      ? state.dropNotices
          .filter(
            (entry) =>
              typeof entry?.text === "string" &&
              Number.isFinite(entry.t) &&
              isValidDropNotice(entry.text),
          )
          .map((entry) => ({
            t: entry.t,
            text: entry.text.replace(/\s+/g, " ").trim().slice(0, 180),
            map: typeof entry.map === "string" && isCanonicalMapName(entry.map.trim())
              ? entry.map.trim()
              : null,
            ...(Number.isFinite(entry.confidence)
              ? { confidence: Math.max(0, Math.min(100, entry.confidence)) }
              : {}),
          }))
          .slice(-100)
      : [];
    if (
      !Number.isSafeInteger(state.mesoStartAmount) ||
      state.mesoStartAmount < 0
    ) {
      state.mesoStartAmount =
        state.mesoSamples?.find((sample) => Number.isSafeInteger(sample?.amount) && sample.amount >= 0)?.amount ?? null;
    }
    state.calibration ||= { level: null, exp: null };
    if (
      state.calibration.auto === undefined &&
      (!state.calibration.level || !state.calibration.exp)
    )
      state.calibration = { level: null, exp: null, auto: true };
    for (const sample of state.samples) {
      const start = levelStartExp(sample.level);
      if (sample.exp > required(sample.level) && sample.exp >= start)
        sample.exp -= start;
    }
    let inferredLevelPending = null,
      pendingLevel = null,
      pendingLevelFrame = null,
      lastSavedPayload = null;
    const samples = () => state.samples.slice().sort((a, b) => a.t - b.t);
    const save = () => {
      if (!storage?.setItem) return false;
      try {
        const payload = {
          ...state,
          schemaVersion: SCHEMA_VERSION,
          screen: null,
          interval: null,
        };
        const serialized = JSON.stringify(payload);
        if (serialized === lastSavedPayload) return true;
        storage.setItem(key, JSON.stringify({ ...payload, updatedAt: now() }));
        lastSavedPayload = serialized;
        return true;
      } catch {
        // Keep in-memory tracking available when browser storage is full or blocked.
        return false;
      }
    };
    const update = (patch) => {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
      const entries = Object.entries(patch);
      if (entries.some(([name]) => !UPDATABLE_FIELDS.has(name))) return false;
      let changed = false;
      for (const [name, value] of entries) {
        if (Object.is(state[name], value)) continue;
        state[name] = value;
        changed = true;
      }
      if (!changed) return false;
      save();
      onChange();
      return true;
    };
    function clearPending() {
      inferredLevelPending = null;
      pendingLevel = pendingLevelFrame = null;
    }
    function addSample(level, exp, t = now(), reading = {}) {
      if (
        !Number.isFinite(level) ||
        !Number.isFinite(exp) ||
        level < 1 ||
        level > 100 ||
        exp < 0 ||
        (level < 100 && exp > required(level))
      )
        return false;
      state.level = level;
      state.samples.push({
        t,
        level,
        exp,
        ...(reading.estimated ? { estimated: true, pct: reading.pct } : {}),
      });
      if (state.samples.length > 240) state.samples = state.samples.slice(-240);
      save();
      onChange();
      return true;
    }
    function reset(t = now()) {
      state.samples = [];
      state.mesoSamples = [];
      state.dropNotices = [];
      state.mesoStartAmount = null;
      state.mesoStatus = "Searching for the inventory balance automatically";
      state.level = null;
      state.startAt = t;
      state.endAt = null;
      state.mapHistory = state.mapName ? [{ t, name: state.mapName }] : [];
      state.mapUpdatedAt = state.mapName ? t : null;
      clearPending();
      save();
      onChange();
    }
    function addMesoSample(amount, t = now()) {
      if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(t))
        return false;
      const last = state.mesoSamples.at(-1);
      if (last && last.t === t) return false;
      if (state.mesoStartAmount === null) state.mesoStartAmount = amount;
      state.mesoSamples.push({ t, amount });
      if (state.mesoSamples.length > 720)
        state.mesoSamples = state.mesoSamples.slice(-720);
      state.mesoStatus = "Meso total read";
      save();
      onChange();
      return true;
    }
    function addDropNotice(text, t = now(), confidence = null) {
      const normalized = String(text || "").replace(/\s+/g, " ").trim();
      if (
        !normalized ||
        normalized.length > 180 ||
        !Number.isFinite(t) ||
        !isValidDropNotice(normalized)
      )
        return false;
      if (
        state.dropNotices.some(
          (entry) => entry.text === normalized && t >= entry.t && t - entry.t < 1200,
        )
      ) return false;
      state.dropNotices.push({
        text: normalized,
        t,
        map: state.mapName || null,
        ...(Number.isFinite(confidence) ? { confidence } : {}),
      });
      if (state.dropNotices.length > 100)
        state.dropNotices = state.dropNotices.slice(-100);
      save();
      onChange();
      return true;
    }
    function setMesoStatus(status) {
      const value = typeof status === "string" ? status.slice(0, 180) : defaults.mesoStatus;
      if (state.mesoStatus === value) return false;
      return update({ mesoStatus: value });
    }
    function setMapName(name, t = now()) {
      const value = String(name || "").trim();
      if (!value || !isCanonicalMapName(value)) return false;
      const timestamp = Number.isFinite(t) ? t : now(),
        before = state.mapHistory.filter((entry) => entry.t < timestamp).at(-1),
        exact = state.mapHistory.find((entry) => entry.t === timestamp && entry.name === value);
      if (!exact && before?.name !== value) {
        state.mapHistory.push({ t: timestamp, name: value });
        state.mapHistory.sort((a, b) => a.t - b.t);
        if (state.mapHistory.length > 1000) state.mapHistory = state.mapHistory.slice(-1000);
      }
      if (state.mapUpdatedAt !== null && timestamp < state.mapUpdatedAt) {
        save();
        onChange();
        return !exact;
      }
      if (value === state.mapName && state.mapUpdatedAt === timestamp) return false;
      state.mapName = value;
      state.mapUpdatedAt = timestamp;
      save();
      onChange();
      return true;
    }
    function setMesoRegion(region) {
      const value = validRegion(region);
      if (!value) return false;
      const prior = state.mesoRegion;
      if (prior && ["x", "y", "w", "h"].every((key) => Math.abs(prior[key] - value[key]) < 0.001))
        return false;
      return update({ mesoRegion: value });
    }
    function setMesoAnchor(region, anchor) {
      if (!region || !anchor) return false;
      const value = validRegion(region);
      if (!value || typeof anchor !== "object" || Array.isArray(anchor)) return false;
      return update({
        mesoRegion: value,
        mesoAnchor: anchor,
        mesoStatus: "Inventory balance found · aligning automatically",
      });
    }
    function validate(levelResult, expResult, expectedDigits, readAt) {
      const independent = parseHudReading("", expResult.rawText),
        independentClean =
          expResult.rawConfidence >= 35 &&
          /^\d[\d.]*\[\d+\.\d{2}%\]$/.test(expResult.rawText),
        levelResolution = levelOcr.resolveLevel(
          levelResult,
          independentClean
            ? Number(independent.expToken?.replace(/,/g, ""))
            : NaN,
          independentClean ? Number(independent.pctToken) : NaN,
          required,
          inferredLevelPending,
          readAt,
        );
      inferredLevelPending = levelResolution.pending;
      const resolvedLevelResult = {
        data: {
          text:
            levelResolution.level === null
              ? "?"
              : String(levelResolution.level),
          confidence:
            levelResolution.source === "exp"
              ? expResult.data.confidence
              : levelResult.data.confidence,
        },
      };
      const { levelMatch, expToken, pctToken } = parseHudReading(
          resolvedLevelResult.data.text,
          expResult.data.text,
        ),
        level = levelMatch ? Number(levelMatch[0]) : NaN,
        exp = expToken
          ? Number(expToken.replace(/,/g, ""))
          : (expResult.percentageOnly?.exp ?? NaN),
        pct = pctToken ? Number(pctToken) : null,
        confidence = Math.round(
          (resolvedLevelResult.data.confidence + expResult.data.confidence) / 2,
        ),
        requiredExp = required(level),
        computedPct = requiredExp ? (exp / requiredExp) * 100 : 0,
        pctOkay =
          pct === null || !requiredExp || Math.abs(computedPct - pct) <= 0.03,
        continuity = levelOcr.checkContinuity(
          resolvedLevelResult,
          state.level,
          pendingLevelFrame !== readAt ? pendingLevel : null,
        ),
        valid =
          continuity.accepted &&
          Number.isInteger(level) &&
          level >= 1 &&
          level <= 100 &&
          Number.isFinite(exp) &&
          exp >= 0 &&
          (level === 100 || exp <= requiredExp) &&
          confidence >= 35 &&
          pctOkay &&
          !expResult.uncertain &&
          (levelResolution.source === "exp" ||
            !expectedDigits ||
            String(level).length === expectedDigits);
      const rejectionReason =
        levelResolution.reason ||
        (!continuity.accepted ? continuity.reason : null) ||
        (expResult.uncertain
          ? "EXP characters are unclear. Keep the HUD visible or reset custom regions."
          : !Number.isFinite(exp)
            ? "No readable EXP amount or percentage"
            : !pctOkay
              ? "EXP amount and percentage disagree for level " + level
              : confidence < 35
                ? "Reading confidence is too low"
                : "Reading skipped. Check that the complete level and EXP text are visible.");
      pendingLevel = continuity.pending;
      pendingLevelFrame = readAt;
      return {
        levelMatch,
        expToken,
        pctToken,
        level,
        exp,
        pct,
        confidence,
        requiredExp,
        computedPct,
        continuity,
        levelResolution,
        valid,
        rejectionReason,
        retry:
          !valid &&
          !(continuity.reason || "").includes("differs from saved level"),
      };
    }
    // Persist the normalized schema once on load; later writes are change-driven.
    save();
    return {
      state,
      key,
      samples,
      update,
      addMesoSample,
      addDropNotice,
      setMesoStatus,
      setMesoRegion,
      setMesoAnchor,
      setMapName,
      save,
      addSample,
      reset,
      clearPending,
      validate,
      math: { required, totalExp, levelStartExp },
    };
  }
  return { required, levelStartExp, totalExp, parseHudReading, create };
});
