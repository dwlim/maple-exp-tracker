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
    now = Date.now,
    onChange = () => {},
  } = {}) {
    const defaults = {
      samples: [],
      mesoSamples: [],
      mesoStatus: "Searching for the inventory balance automatically",
      level: null,
      source: null,
      running: false,
      startAt: null,
      calibration: { level: null, exp: null, auto: true },
    };
    let saved = {};
    try {
      saved = JSON.parse(storage?.getItem(key) || "{}") || {};
    } catch {}
    const state = {
      ...defaults,
      ...saved,
      running: false,
      source: null,
      paused: false,
    };
    state.calibration ||= { level: null, exp: null };
    if (
      state.calibration.auto === undefined &&
      (!state.calibration.level || !state.calibration.exp)
    )
      state.calibration = { level: null, exp: null, auto: true };
    for (const sample of state.samples || []) {
      const start = levelStartExp(sample.level);
      if (sample.exp > required(sample.level) && sample.exp >= start)
        sample.exp -= start;
    }
    let inferredLevelPending = null,
      pendingLevel = null,
      pendingLevelFrame = null;
    const samples = () => state.samples.slice().sort((a, b) => a.t - b.t);
    const save = () =>
      storage?.setItem(
        key,
        JSON.stringify({
          ...state,
          screen: null,
          interval: null,
          updatedAt: now(),
        }),
      );
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
      onChange();
      return true;
    }
    function reset() {
      state.samples = [];
      state.mesoSamples = [];
      state.mesoStatus = "Searching for the inventory balance automatically";
      state.level = null;
      state.startAt = now();
      clearPending();
      onChange();
    }
    function addMesoSample(amount, t = now()) {
      if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(t))
        return false;
      const last = state.mesoSamples.at(-1);
      if (last && last.t === t) return false;
      state.mesoSamples.push({ t, amount });
      if (state.mesoSamples.length > 720)
        state.mesoSamples = state.mesoSamples.slice(-720);
      state.mesoStatus = "Meso total read";
      onChange();
      return true;
    }
    function setMesoStatus(status) {
      state.mesoStatus = status;
      onChange();
    }
    function setMesoAnchor(region, anchor) {
      if (!region || !anchor) return false;
      state.mesoRegion = region;
      state.mesoAnchor = anchor;
      state.mesoStatus = "Inventory balance found · aligning automatically";
      save();
      onChange();
      return true;
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
    return {
      state,
      key,
      samples,
      addMesoSample,
      setMesoStatus,
      setMesoAnchor,
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
