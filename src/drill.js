/* Practice text. Drills train combinations, not isolated keys: random groups
   of 2–6 characters, at least ~40% from the lesson's keys, the rest from
   everything already learned, with deliberate hard transitions mixed in.
   Each character depends on the group so far, like a Markov chain: a key
   rarely follows itself and rarely appears a third time in one group. */
(function (N) {
  const FOCUS_SHARE = 0.4;
  /* Each focus key is at least this many times as common as any other key. */
  const FOCUS_MIN_WEIGHT = 2;
  /* Weight multipliers: a key right after itself (dd), a key already twice in its group. */
  const REPEAT_PENALTY = 0.15;
  const THIRD_PENALTY = 0.1;
  /* Group length: 4 most often, 3 and 5 sometimes, 2 and 6 rarely. */
  const SIZES = [[2, 0.1], [3, 0.2], [4, 0.4], [5, 0.2], [6, 0.1]];
  const UNIQUE_TRIES = 20;

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

  const pickWeighted = (items, weightOf, rng) => {
    const ws = items.map(weightOf);
    let r = rng() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) if ((r -= ws[i]) < 0) return items[i];
    return items[items.length - 1];
  };

  /* Hard transitions: the same finger on a different row (de, fr, ki), or a
     jump between top and bottom row on the same hand (ec, ix). */
  N.isHardPair = function (layout, a, b) {
    const ka = N.keyFor(layout, a), kb = N.keyFor(layout, b);
    if (!ka || !kb || ka.code === kb.code || ka.finger === "th" || kb.finger === "th") return false;
    if (ka.finger === kb.finger && ka.row !== kb.row) return true;
    return N.isLeft(ka.finger) === N.isLeft(kb.finger) && Math.abs(ka.row - kb.row) === 2 && ka.row !== 0 && kb.row !== 0;
  };

  N.hardPairs = function (layout, chars) {
    const out = [];
    for (const a of chars) for (const b of chars) if (N.isHardPair(layout, a, b)) out.push(a + b);
    return out;
  };

  /* Weight of each focus key, so focus keys make up at least FOCUS_SHARE of
     the text and each is at least FOCUS_MIN_WEIGHT times as common as any
     other key. Other keys weigh 1. */
  function focusWeight(focusCount, restCount) {
    if (!restCount) return 1;
    return Math.max(FOCUS_MIN_WEIGHT, (FOCUS_SHARE / (1 - FOCUS_SHARE)) * (restCount / focusCount));
  }

  /* One group of `size` characters. A hard pair, if given, sits at `pairAt`;
     the other characters are drawn one by one, each weighed against its
     neighbours and against how often it already appears in the group. */
  function makeGroup({ size, pair, pairAt, all, isFocus, weightOf, rng }) {
    const g = new Array(size).fill(null);
    if (pair) { g[pairAt] = pair[0]; g[pairAt + 1] = pair[1]; }
    const free = g.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
    const lastFree = free[free.length - 1];
    for (const i of free) {
      const needFocus = i === lastFree && !g.some((c) => c !== null && isFocus(c));
      const candidates = needFocus ? all.filter(isFocus) : all;
      g[i] = pickWeighted(candidates, (c) => {
        let w = weightOf(c);
        if (c === g[i - 1] || c === g[i + 1]) w *= REPEAT_PENALTY;
        if (g.filter((x) => x === c).length >= 2) w *= THIRD_PENALTY;
        return w;
      }, rng);
    }
    return g;
  }

  /* opts: { layout, focus:[chars], pool:[chars], length, hard (share of groups
     with a forced hard pair), caps (share of groups starting with a capital), rng } */
  N.generateDrill = function ({ layout, focus, pool, length = 70, hard = 0.3, caps = 0, rng = Math.random }) {
    focus = [...new Set(focus)];
    const all = [...new Set([...focus, ...pool])];
    const isFocus = (c) => focus.includes(c);
    const fw = focusWeight(focus.length, all.length - focus.length);
    const weightOf = (c) => (isFocus(c) ? fw : 1);
    const pairs = N.hardPairs(layout, all);
    const focusPairs = pairs.filter((p) => isFocus(p[0]) || isFocus(p[1]));
    const pairSource = focusPairs.length ? focusPairs : pairs;

    const groups = [];
    const seen = new Set();
    let total = 0;
    while (total + 4 < length) {
      const size = pickWeighted(SIZES, (s) => s[1], rng)[0];
      let pair = null, pairAt = -1;
      if (pairSource.length && rng() < hard) {
        const p = pick(pairSource, rng);
        if (size > 2 || isFocus(p[0]) || isFocus(p[1])) { pair = p; pairAt = Math.floor(rng() * (size - 1)); }
      }
      let g;
      for (let t = 0; t < UNIQUE_TRIES; t++) {
        g = makeGroup({ size, pair, pairAt, all, isFocus, weightOf, rng });
        if (!seen.has(g.join(""))) break;
      }
      seen.add(g.join(""));
      if (caps && rng() < caps) {
        const up = g[0].toUpperCase();
        if (up !== g[0] && N.keyFor(layout, up)) g[0] = up;
      }
      groups.push(g.join(""));
      total += size + (groups.length > 1 ? 1 : 0);
    }
    return groups.join(" ");
  };

  /* Random common words until the text reaches `length` characters. */
  N.wordsText = function (words, length, rng = Math.random) {
    const out = [];
    let total = 0;
    while (total < length) {
      const w = pick(words, rng);
      out.push(w);
      total += w.length + 1;
    }
    return out.join(" ");
  };

  /* Whole sentences until the text reaches `length` characters. */
  N.sentencesText = function (sentences, length, rng = Math.random) {
    const out = [];
    let total = 0;
    while (total < length) {
      const s = pick(sentences, rng);
      if (sentences.length > 1 && out[out.length - 1] === s) continue;
      out.push(s);
      total += s.length + 1;
    }
    return out.join(" ");
  };
})(Notch);
