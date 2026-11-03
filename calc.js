/* Sunshine Island Calculator: pure logic. No game numbers live in this file.
   Every table, Library value and rune comes from the JSON files named in dashboard_manifest.json.
   Tags: seen < estimated < unconfirmed (worst tag wins). */
(function (root) {
  'use strict';
  const TAG_RANK = { seen: 0, estimated: 1, unconfirmed: 2 };
  const worst = (...t) => t.filter(Boolean).reduce((a, b) => (TAG_RANK[b] > TAG_RANK[a] ? b : a), 'seen');
  const RUNE_FLAG = /^(.+)_rune_active_when_recorded$/;
  const num = (s) => { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  /* ---------- model ---------- */
  function buildModel(files) {
    const lib = files.library, mods = files.modifiers;
    const asr = files.manifest && files.manifest.assumed_slider_range;
    const usr = files.manifest && files.manifest.user_stated_slider_ranges;
    const model = {
      lib, producers: {}, productProducers: {}, runes: {}, productRune: {},
      islands: [], flags: { unconfirmed: [], notYetSeen: [], contradictions: [], byIsland: {} },
      fileTotals: {}, defaults: { runes: {}, happiness: {} }
    };
    // runes: any key rune_<x> under game_modifiers.runes
    const rs = (mods.game_modifiers && mods.game_modifiers.runes) || {};
    Object.keys(rs).forEach((k) => {
      if (!/^rune_/.test(k)) return;
      const x = k.slice(5), r = rs[k];
      const pct = num(r.effect_displayed) / 100;
      model.runes[x] = { key: k, id: x, label: r.label_as_seen || k, pct, island: r.island, building: r.applies_to_building_type, covers: r.covers_products_user_stated || [], raw: r };
      (r.covers_products_user_stated || []).forEach((p) => { model.productRune[p] = x; });
    });
    files.islands.forEach((isl) => {
      const d = isl.data, name = d.meta && d.meta.island ? d.meta.island : isl.name;
      model.islands.push(name);
      model.fileTotals[name] = d.totals || null;
      model.flags.byIsland[name] = { meta: d.meta, checklist: d.checklist, checks_run: d.checks_run, seed_ratios: d.seed_mode_ratios_HYPOTHESIS };
      (d.UNCONFIRMED || []).forEach((t) => model.flags.unconfirmed.push({ island: name, text: t }));
      (d.NOT_YET_SEEN || []).forEach((t) => model.flags.notYetSeen.push({ island: name, text: t }));
      (d.contradictions || []).forEach((t) => model.flags.contradictions.push({ island: name, c: t }));
      (d.producers || []).forEach((p) => {
        const sl = String(p.has_batch_slider || 'no');
        let slider = null;
        const m = sl.match(/^yes.*x(\d+)\s*to\s*x(\d+)/i);
        let sliderAssumed = false;
        if (m) slider = { min: +m[1], max: +m[2] };
        else if (/^yes/i.test(sl) && usr && usr[p.producer_id] && isNum(usr[p.producer_id].min)) slider = { min: usr[p.producer_id].min, max: usr[p.producer_id].max };
        else if (/^yes/i.test(sl) && asr && isNum(asr.min) && isNum(asr.max)) { slider = { min: asr.min, max: asr.max }; sliderAssumed = true; }
        const P = {
          id: p.producer_id, name: p.library_name || p.producer_id, island: name, category: p.category,
          maxLevel: p.max_level, modes: Array.isArray(p.modes) ? p.modes : ['none'],
          slider, sliderAssumed, sliderNote: (!slider || sliderAssumed) ? (/NOT_YET_SEEN|UNCONFIRMED/.test(sl) ? sl : null) : null,
          maxOwned: isNum(p.max_owned) ? p.max_owned : null, maxOwnedRaw: p.max_owned,
          tables: [], evidence: []
        };
        (p.tables || []).forEach((t) => {
          if (t.slider_evidence) { P.evidence.push(t.slider_evidence); return; }
          if (!t.levels) return;
          if (t.levels.some((r) => isNum(r.max_cycles))) P.hasMaxCycles = true;
          let runeFlag = null, runeId = null;
          Object.keys(t).forEach((k) => { const mm = k.match(RUNE_FLAG); if (mm) { runeId = mm[1]; runeFlag = t[k]; } });
          t._runeFlag = runeFlag; t._runeFlagId = runeId;
          t._levelMap = {}; t.levels.forEach((r) => { t._levelMap[r.level] = r; });
          P.tables.push(t);
          if (runeFlag === true && runeId) model.defaults.runes[normRune(model, runeId)] = true;
          if (isNum(t.coin_inputs_include_happiness_penalty_pct) && model.defaults.happiness[name] === undefined)
            model.defaults.happiness[name] = t.coin_inputs_include_happiness_penalty_pct;
          const pl = (model.productProducers[t.product_id] = model.productProducers[t.product_id] || []);
          if (pl.indexOf(P.id) < 0) pl.push(P.id);
        });
        model.producers[P.id] = P;
      });
    });
    return model;
  }
  // flag prefix "mines" -> rune id "mines"; tolerate plural/singular mismatches
  function normRune(model, id) {
    if (model.runes[id]) return id;
    const alt = Object.keys(model.runes).find((k) => k.indexOf(id) === 0 || id.indexOf(k) === 0);
    return alt || id;
  }

  /* ---------- Library ---------- */
  function libLevel(model, setup, id) {
    const o = setup && setup.library && setup.library[id];
    if (isNum(o)) return o;
    const pl = model.lib.player_levels[id];
    return pl ? pl.current : 0;
  }
  function libIdsFor(model, product) {
    // Library ids may use the singular of a product name (product daisies, library daisy_bonus_vol_1). Try exact, then singular forms.
    const cands = [product, product.replace(/ies$/, 'y'), product.replace(/s$/, '')];
    for (const c of cands) {
      const re = new RegExp('^' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_bonus_vol_\\d+$');
      const ids = Object.keys(model.lib.game_upgrades).filter((id) => re.test(id));
      if (ids.length) return ids;
    }
    return [];
  }
  function libBonus(model, setup, product) {
    let sum = 0, unknown = [], parts = [];
    libIdsFor(model, product).forEach((id) => {
      const lv = libLevel(model, setup, id);
      if (!lv) return;
      const v = model.lib.game_upgrades[id].levels[String(lv)];
      if (v === undefined) { unknown.push(id + ' lvl ' + lv); return; }
      sum += num(v); parts.push(id + ' L' + lv + ' ' + v);
    });
    return { value: sum, unknown, parts };
  }

  /* ---------- re-basing (HYPOTHESIS: rune acts on base, then Library flat is added) ---------- */
  function invCeil(x, f) {
    const c = Math.round(x / f);
    for (let k = 0; k <= 3; k++) for (const b of [c - k, c + k]) if (b >= 0 && Math.ceil(b * f) === x) return b;
    return Math.floor(x / f);
  }

  /* ---------- setup defaults ---------- */
  function defaultSetup(model) {
    return {
      library: {},
      runes: Object.assign({}, model.defaults.runes),
      happiness: Object.assign({}, model.defaults.happiness),
      rows: []
    };
  }

  /* ---------- resolve one building configuration ---------- */
  function pickTable(P, product, mode, level, runeNow, runeId) {
    const cands = P.tables.filter((t) => t.product_id === product && t.mode === mode);
    if (!cands.length) return null;
    const has = cands.filter((t) => t._levelMap[level]);
    if (!has.length) return null;
    const score = (t) => {
      let s = 0;
      if (t._levelMap[level].status === 'seen') s += 4;
      if (runeId && t._runeFlag === runeNow) s += 2;
      return s;
    };
    return has.slice().sort((a, b) => score(b) - score(a))[0];
  }

  function sliderSeen(P, product, n, level) {
    if (n === 1) return true;
    return P.evidence.some((e) => e.product_id === product && !(P.hasMaxCycles && isNum(e.at_building_level) && e.at_building_level !== level) && (e.rows || []).some((r) => r.slider === 'x' + n && !r.status));
  }

  function resolve(model, setup, ref) {
    const P = model.producers[ref.producer];
    const mode = (P && P.modes[0] === 'none') ? 'none' : (ref.mode || (P && P.modes[0]));
    const level = ref.level;
    let n = ref.slider === 'max' ? 0 : Math.max(1, ref.slider || 1);
    const miss = (why) => ({ ok: false, tag: 'unconfirmed', reason: why, ref });
    if (!P) return miss('producer not in data');
    if (ref.slider !== 'max' && n > 1 && !P.slider) return miss('this building has no stack setting in the data');
    if (P.slider && ref.slider !== 'max' && (n < P.slider.min || n > P.slider.max)) return miss('that stack size is outside the range recorded for this building');
    const runeId = model.productRune[ref.product] || null;
    const runeNow = runeId ? !!(setup.runes && setup.runes[runeId]) : false;
    const t = pickTable(P, ref.product, mode, level, runeNow, runeId);
    if (!t) return miss('NOT_YET_SEEN: no recorded row for this product / mode / level');
    const row = t._levelMap[level];
    const notes = [];
    const mcRow = isNum(row.max_cycles) ? row.max_cycles : null;
    if (ref.slider === 'max') n = mcRow || 1;
    if (mcRow && n > mcRow) return miss('A stack of x' + n + ' is not possible at level ' + level + '. The biggest stack at this level is x' + mcRow + '.');
    const rune = runeId ? model.runes[runeId] : null;
    const pct = rune ? rune.pct : 0;
    const runeRec = runeId ? (t._runeFlag === null ? null : !!t._runeFlag) : false;
    const libNowB = libBonus(model, setup, ref.product);
    const libRec = isNum(t.library_bonus_assumed) ? t.library_bonus_assumed : null;
    const libNow = libNowB.value;

    // output
    let out = row.output_qty, outTag = row.status === 'seen' ? 'seen' : 'estimated';
    const hasLibForProduct = libIdsFor(model, ref.product).length > 0;
    if (libRec === null) {
      if (libNow > 0 || hasLibForProduct) notes.push('Library +' + libNow + ' for ' + ref.product + ': whether it is already inside this recorded output is UNCONFIRMED');
      out = row.output_qty;
      if (libNow > 0) outTag = worst(outTag, 'unconfirmed');
    } else if (runeId && runeRec === null && runeNow !== false) {
      outTag = 'unconfirmed'; notes.push('rune state when recorded is UNCONFIRMED');
    } else if ((runeId && runeRec !== runeNow) || libRec !== libNow) {
      const base = row.output_qty - libRec;
      const b = (runeId && runeRec) ? invCeil(base, 1 + pct) : base;
      const nb = (runeId && runeNow) ? Math.ceil(b * (1 + pct)) : b;
      out = nb + libNow; const runeDiff = !!(runeId && runeRec !== runeNow); if (runeDiff && row.status !== 'seen') outTag = worst(outTag, 'estimated');
      const bits = [];
      if (runeId && runeRec !== runeNow) bits.push('rune ' + (runeRec ? 'on' : 'off') + ' when recorded, ' + (runeNow ? 'on' : 'off') + ' now');
      if (libRec !== libNow) bits.push('Library +' + libRec + ' when recorded, +' + libNow + ' now');
      notes.push(runeDiff ? 'Re-based (' + bits.join('; ') + '): with a rune on, each building can be 1 lower than the game (tested on 100 Jade Mine rows: 90 exact, 10 one low)' : 'Re-based for your Library level (' + bits.join('; ') + '): flat bonus swapped, exact if the recorded Library level is right');
    }
    if (libNowB.unknown.length) { outTag = 'unconfirmed'; notes.push('Library level value not recorded: ' + libNowB.unknown.join(', ')); }
    if (row.status !== 'seen' && row.estimate_basis) notes.push('Estimated row: ' + row.estimate_basis);

    // second output
    let second = null;
    if (row.second_output) second = { product: row.second_output.product_id, v: row.second_output.qty, tag: (row.status === 'seen' && !row.second_output.estimated) ? 'seen' : 'estimated' };

    // cycle
    let cycle = null;
    const cm = row.cycle_minutes !== undefined ? row.cycle_minutes : t.cycle_minutes;
    if (isNum(cm)) cycle = { v: cm, tag: row.status === 'seen' || row.cycle_minutes === undefined ? 'seen' : 'estimated' };

    // inputs
    const rawIn = row.inputs || t.inputs || [];
    const pRec = (isNum(t.coin_inputs_include_happiness_penalty_pct) ? t.coin_inputs_include_happiness_penalty_pct : 0) / 100;
    const pNowPct = setup.happiness && setup.happiness[P.island];
    const pNow = (isNum(pNowPct) ? pNowPct : pRec * 100) / 100;
    const tableLevelInputs = !row.inputs;
    let inTag = 'seen';
    if (tableLevelInputs && P.category === 'processing' && level > 5 && !t.inputs_seen_all_levels) inTag = 'unconfirmed';
    if (row.status !== 'seen' && row.inputs) inTag = 'estimated';
    const inputs = rawIn.map((i) => {
      let q = i.qty, tag = inTag;
      if (i.product_id === 'coins' && pNow !== pRec) { q = q * (1 + pNow) / (1 + pRec); tag = worst(tag, 'estimated'); }
      return { product: i.product_id, qty: q, tag };
    });
    if (tableLevelInputs && P.category === 'processing' && level > 5 && !t.inputs_seen_all_levels) notes.push('Inputs recorded once per table; not seen to stay the same above level 5 (UNCONFIRMED)');
    if (inputs.some((i) => i.product === 'coins' && i.tag !== 'seen' && pNow !== pRec)) notes.push('Coins rescaled for happiness penalty ' + Math.round(pNow * 100) + '% vs ' + Math.round(pRec * 100) + '% recorded (HYPOTHESIS)');

    // batch slider
    let sTag = 'seen';
    if (n > 1) {
      out *= n; if (second) second = Object.assign({}, second, { v: second.v * n });
      if (cycle) cycle = { v: cycle.v * n, tag: cycle.tag };
      inputs.forEach((i) => { i.qty *= n; });
      if (P.sliderAssumed) { sTag = 'unconfirmed'; notes.push('Stack range x' + P.slider.min + ' to x' + P.slider.max + ' is not seen on this building; it is taken from what you said about the other stacks (UNCONFIRMED)'); }
      if (P.sliderAssumed) { /* tag already unconfirmed */ }
      else if (!sliderSeen(P, ref.product, n, level)) { notes.push('A stack of x' + n + ' is ' + n + ' times the x1 row. The game matched this on the Feed Mill, Silo, Foundry and Spinning Works (cotton yarn), so it is treated as confirmed.'); }
      else notes.push('Stack of x' + n + ' seen in the game for ' + ref.product);
      outTag = worst(outTag, sTag); inputs.forEach((i) => { i.tag = worst(i.tag, sTag); });
      if (cycle) cycle.tag = worst(cycle.tag, sTag);
    }
    const perHour = (cycle && cycle.v > 0) ? { v: out * 60 / cycle.v, tag: worst(outTag, cycle.tag) } : null;
    const instant = !cycle;
    return {
      ok: true, ref, mode, level, slider: n, producer: P, table: t, rowStatus: row.status,
      out: { v: out, tag: outTag }, second, cycle, instant, perHour, inputs, notes,
      lib: { now: libNow, rec: libRec, parts: libNowB.parts }, runeId, runeNow, runeRec,
      tag: worst(outTag, cycle && cycle.tag, ...inputs.map((i) => i.tag))
    };
  }

  /* ---------- plan ---------- */
  function refConfig(model, setup, product) {
    const mine = (setup.rows || []).filter((r) => r.product === product);
    let best = null;
    mine.forEach((r) => { const res = resolve(model, setup, r); if (res.ok && res.perHour && (!best || res.perHour.v > best.res.perHour.v)) best = { ref: r, res, own: true }; });
    if (best) return best;
    const pids = model.productProducers[product];
    if (!pids || !pids.length) return null;
    const P = model.producers[pids[0]];
    const mode = P.modes[0] === 'none' ? 'none' : (P.modes.indexOf('regular') >= 0 ? 'regular' : P.modes[0]);
    const ref = { producer: P.id, product, mode, level: P.maxLevel, slider: 1 };
    const res = resolve(model, setup, ref);
    return { ref, res, own: false };
  }

  function plan(model, setup, target) {
    const need = {}, external = {}, order = [], warnings = [];
    const cfg = {};
    function walk(product, rate, depth) {
      if (depth > 8) { warnings.push('Chain deeper than 8 levels, stopped at ' + product); return; }
      if (!cfg[product]) cfg[product] = refConfig(model, setup, product);
      const c = cfg[product];
      if (!need[product]) { need[product] = 0; order.push(product); }
      need[product] += rate;
      if (!c || !c.res.ok) { warnings.push(product + ': no usable recorded row (' + (c && c.res.reason || 'no producer') + ')'); return; }
      const r = c.res;
      if (r.instant) { warnings.push(product + ': best row is Instant, so there is no per-hour rate'); return; }
      r.inputs.forEach((i) => {
        const perUnit = i.qty / r.out.v;
        const sub = rate * perUnit;
        if (model.productProducers[i.product]) walk(i.product, sub, depth + 1);
        else {
          const e = (external[i.product] = external[i.product] || { qty: 0, tag: 'seen' });
          e.qty += sub; e.tag = worst(e.tag, i.tag);
        }
      });
    }
    walk(target.product, target.perHour, 0);
    const lines = order.map((product) => {
      const c = cfg[product];
      const line = { product, need: need[product], cfg: c };
      if (!c || !c.res.ok || !c.res.perHour) { line.unusable = true; return line; }
      const P = c.res.producer;
      line.producer = P; line.perBuilding = c.res.perHour;
      line.buildings = need[product] / c.res.perHour.v;
      const mine = (setup.rows || []).filter((r) => r.product === product).map((r) => resolve(model, setup, r)).filter((x) => x.ok && x.perHour);
      line.ownedCount = mine.length;
      line.ownedRate = mine.reduce((s, x) => s + x.perHour.v, 0);
      line.ratio = line.ownedRate / need[product];
      line.singleLimitBroken = P.maxOwned !== null && Math.ceil(line.buildings - 1e-9) > P.maxOwned && line.ownedCount <= P.maxOwned;
      line.tag = c.res.tag;
      line.usingDefault = !c.own;
      return line;
    });
    const usable = lines.filter((l) => !l.unusable);
    let bottleneck = null, maxTarget = null;
    if (usable.length) {
      bottleneck = usable.reduce((a, b) => (b.ratio < a.ratio ? b : a));
      maxTarget = target.perHour * bottleneck.ratio;
    }
    let coins = 0; if (external.coins) coins = external.coins.qty;
    return { target, lines, external, warnings, bottleneck, maxTarget, coins };
  }

  /* ---------- integrity (reads the same files the page shows) ---------- */
  function integrity(model, files) {
    const out = [];
    files.islands.forEach((isl) => {
      const d = isl.data, name = d.meta && d.meta.island || isl.name;
      let tables = 0, seen = 0, est = 0; const bad = [];
      (d.producers || []).forEach((p) => (p.tables || []).forEach((t) => {
        if (!t.levels) return; tables++;
        const s = t.levels.filter((r) => r.status === 'seen').length, e = t.levels.filter((r) => r.status === 'estimated').length;
        seen += s; est += e;
        if (t.seen_count !== undefined && (t.seen_count !== s || t.estimated_count !== e)) bad.push(p.producer_id + '/' + t.product_id + '/' + t.mode + ': counted ' + s + ' seen, ' + e + ' estimated; file says ' + t.seen_count + ', ' + t.estimated_count);
        if (isNum(t.library_bonus_assumed)) {
          const lb = libBonus(model, { library: {} }, t.product_id).value;
          if (lb !== t.library_bonus_assumed) bad.push(p.producer_id + '/' + t.product_id + ': Library gives +' + lb + ', table assumed +' + t.library_bonus_assumed);
        }
      }));
      const tot = d.totals;
      const totOk = !tot || (tot.tables === tables && tot.rows_seen === seen && tot.rows_estimated === est);
      out.push({ island: name, tables, seen, est, fileTotals: tot, totalsMatch: totOk, problems: bad });
    });
    return out;
  }

  /* top slider setting for a building level: row max_cycles if recorded, else the old fixed cap (pre-update, flagged) */
  function maxCycles(model, P, product, mode, level) {
    if (!P || !P.slider) return { top: 1, seen: false };
    const m = (P.modes[0] === 'none') ? 'none' : mode;
    const runeId = model.productRune[product] || null;
    const t = pickTable(P, product, m, level, false, runeId);
    const row = t && t._levelMap[level];
    if (row && isNum(row.max_cycles)) return { top: row.max_cycles, seen: true };
    return { top: 1, seen: false };
  }

  const api = { maxCycles, buildModel, defaultSetup, resolve, plan, integrity, libBonus, libIdsFor, libLevel, invCeil, worst, TAG_RANK, refConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(typeof self !== 'undefined' ? self : this);
