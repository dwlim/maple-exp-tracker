(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MaplePotionCosts = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const KEY = "maple-track-potion-costs-v1";
  // NPC BUY prices, checked 2026-10-25. Not sell-back or Free Market prices.
  // https://meowdb.com/msclassic/npc-shops (Mina/Luna/Arturo launch shop records).
  const catalog = {
    red: { group: "hp", price: 50 },
    orange: { group: "hp", price: 150 },
    white: { group: "hp", price: 350 },
    blue: { group: "mp", price: 220 },
    meat: { group: "hp", price: 80 },
    lemon: { group: "mp", price: 150 },
    mana: { group: "mp", price: null },
    hp: { group: "hp", price: null },
    mp: { group: "mp", price: null },
    both: { group: "both", price: null },
  };
  const validPrice = (n) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1e9;
  function price(item) {
    return validPrice(item?.unitCost)
      ? item.unitCost
      : (catalog[item?.potionType]?.price ?? null);
  }
  function snapshot(store, live, now) {
    return {
      updatedAt: now,
      enabled: !!live && store?.state.enabled === true,
      items: (store?.state.items || [])
        .filter((i) => catalog[i.potionType])
        .map((i) => ({
          group: catalog[i.potionType].group,
          price: price(i),
          rate: store.rate(i, now),
          lastReadAt: i.at,
        })),
    };
  }
  function metrics(state, now) {
    const out = { hp: null, mp: null, both: null, hasBoth: false };
    if (
      !state ||
      !Array.isArray(state.items) ||
      state.enabled !== true ||
      !Number.isFinite(state.updatedAt) ||
      state.updatedAt > now ||
      now - state.updatedAt > 25000
    )
      return out;
    for (const group of ["hp", "mp", "both"]) {
      const items = state.items.filter((i) => i?.group === group);
      if (group === "both") out.hasBoth = items.length > 0;
      if (!items.length) continue;
      let sum = 0,
        valid = true;
      for (const i of items) {
        if (
          !validPrice(i.price) ||
          !Number.isFinite(i.rate) ||
          i.rate < 0 ||
          !Number.isFinite(i.lastReadAt) ||
          i.lastReadAt > now ||
          now - i.lastReadAt > 25000
        ) {
          valid = false;
          break;
        }
        sum += i.price * i.rate;
      }
      if (valid && Number.isFinite(sum)) out[group] = sum;
    }
    return out;
  }
  return { KEY, catalog, price, validPrice, snapshot, metrics };
});
