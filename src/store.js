/* Progress: one JSON document in localStorage, versioned by `schema`.
   Everything here is pure except load()/save(), which wrap localStorage. */
(function (N) {
  N.SCHEMA = 1;
  /* Every file:// page in Chromium shares one localStorage, so all keys are
     prefixed with "notch:", and nothing ever calls localStorage.clear(). */
  N.STORAGE_KEY = "notch:state";
  const LEGACY_KEY = "notch"; // used before the prefix; moved on first load

  N.DEFAULT_RULES = { acc: 97, speedCap: 45, oppositeShift: true, fingerColors: true, noLook: false };

  N.freshState = () => ({
    schema: N.SCHEMA,
    settings: { ui: null, practice: [], layout: null, setupDone: false },
    rules: { ...N.DEFAULT_RULES },
    customLayout: null, // a calibrated layout, in registerLayout() form
    lessons: {}, // id -> { window, rounds, passedOn, roundsToPass, bestAcc, bestWpm }
    newLessonOn: null, // the day a new lesson was last passed
    days: {}, // YYYY-MM-DD -> day record, see N.day()
  });

  /* Fill anything missing so older or partial documents keep working. */
  N.upgradeState = function (s) {
    const fresh = N.freshState();
    return {
      ...fresh,
      ...s,
      schema: N.SCHEMA,
      settings: { ...fresh.settings, ...s.settings },
      rules: { ...fresh.rules, ...s.rules },
      lessons: s.lessons || {},
      days: s.days || {},
    };
  };

  N.load = function () {
    try {
      if (localStorage.getItem(N.STORAGE_KEY) === null && localStorage.getItem(LEGACY_KEY) !== null) {
        localStorage.setItem(N.STORAGE_KEY, localStorage.getItem(LEGACY_KEY));
        localStorage.removeItem(LEGACY_KEY);
      }
      const raw = localStorage.getItem(N.STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.schema <= N.SCHEMA) return N.upgradeState(s);
      }
    } catch (_) { /* storage blocked or corrupt: start fresh */ }
    return N.freshState();
  };

  N.save = function (state) {
    try {
      localStorage.setItem(N.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (_) {
      return false;
    }
  };

  /* ---------- Dates (local calendar days) ---------- */

  const pad = (n) => String(n).padStart(2, "0");
  N.dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  N.addDays = function (key, n) {
    const [y, m, d] = key.split("-").map(Number);
    return N.dayKey(new Date(y, m - 1, d + n));
  };
  N.parseDay = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };

  /* ---------- Days ---------- */

  /* session: seconds on today's 30-minute clock. typedMs/advanced feed wpm,
     hits/misses feed accuracy, keys: char -> [attempts, errors]. */
  N.day = function (state, key) {
    return (state.days[key] ||= { session: 0, typedMs: 0, advanced: 0, hits: 0, misses: 0, keys: {}, tests: [] });
  };

  N.recordKey = function (day, ch, ok) {
    if (ch === " ") return;
    const k = ch.toLowerCase();
    const r = (day.keys[k] ||= [0, 0]);
    r[0]++;
    if (!ok) r[1]++;
    ok ? day.hits++ : day.misses++;
  };

  /* Per-key [attempts, errors] over the `span` days ending today. */
  N.keyTotals = function (days, today, span) {
    const out = {};
    for (let i = 0; i < span; i++) {
      const d = days[N.addDays(today, -i)];
      if (!d) continue;
      for (const k in d.keys) {
        const r = (out[k] ||= [0, 0]);
        r[0] += d.keys[k][0];
        r[1] += d.keys[k][1];
      }
    }
    return out;
  };

  /* The keys with the highest error rate over the last 7 days. */
  N.weakKeys = function (days, today, learned, n = 3, minAttempts = 15) {
    const totals = N.keyTotals(days, today, 7);
    return Object.entries(totals)
      .filter(([k, [att, err]]) => learned.has(k) && att >= minAttempts && err > 0)
      .map(([k, [att, err]]) => ({ key: k, rate: (100 * err) / att }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, n);
  };

  N.practised = (d) => !!d && (d.typedMs > 0 || d.tests.length > 0);

  /* Consecutive practice days ending today (or yesterday, if today is still empty). */
  N.streak = function (days, today) {
    let k = N.practised(days[today]) ? today : N.addDays(today, -1);
    let n = 0;
    while (N.practised(days[k])) { n++; k = N.addDays(k, -1); }
    return n;
  };

  N.longestStreak = function (days) {
    let best = 0;
    for (const k of Object.keys(days).sort()) {
      if (!N.practised(days[k]) || N.practised(days[N.addDays(k, -1)])) continue;
      let n = 0, d = k;
      while (N.practised(days[d])) { n++; d = N.addDays(d, 1); }
      best = Math.max(best, n);
    }
    return best;
  };

  N.dayWpm = (d) => (d && d.typedMs > 0 ? d.advanced / 5 / (d.typedMs / 60000) : null);
  N.dayAccuracy = (d) => (d && d.hits + d.misses ? (100 * d.hits) / (d.hits + d.misses) : null);

  /* Totals over the `span` days ending today, for headline numbers. */
  N.periodStats = function (days, today, span) {
    let typedMs = 0, advanced = 0, hits = 0, misses = 0;
    for (let i = 0; i < span; i++) {
      const d = days[N.addDays(today, -i)];
      if (!d) continue;
      typedMs += d.typedMs; advanced += d.advanced; hits += d.hits; misses += d.misses;
    }
    return { wpm: N.dayWpm({ typedMs, advanced }), acc: N.dayAccuracy({ hits, misses }) };
  };

  /* ---------- Backup ---------- */

  N.makeBackup = (state, today) => ({ app: "notch", schema: N.SCHEMA, exported: today, state });

  /* Returns { ok: true, state } or { ok: false, reason: "json" | "notNotch" | "newer" | "broken" }. */
  N.readBackup = function (text) {
    let data;
    try { data = JSON.parse(text); } catch (_) { return { ok: false, reason: "json" }; }
    if (!data || data.app !== "notch") return { ok: false, reason: "notNotch" };
    if (typeof data.schema !== "number" || data.schema > N.SCHEMA) return { ok: false, reason: "newer" };
    const s = data.state;
    const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
    if (!isObj(s) || !isObj(s.settings) || !isObj(s.lessons) || !isObj(s.days)) return { ok: false, reason: "broken" };
    return { ok: true, state: N.upgradeState(s) };
  };
})(Notch);
