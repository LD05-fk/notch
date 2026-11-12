/* Practice text. Drills train combinations, not isolated keys: random groups
   of 3–6 characters, ~40% from the lesson's keys, the rest from everything
   already learned, with deliberate hard transitions mixed in. */
(function (N) {
  const FOCUS_SHARE = 0.4;

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

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

  /* opts: { layout, focus:[chars], pool:[chars], length, hard (share of groups
     with a forced hard pair), caps (share of groups starting with a capital), rng } */
  N.generateDrill = function ({ layout, focus, pool, length = 70, hard = 0.3, caps = 0, rng = Math.random }) {
    focus = [...new Set(focus)];
    const all = [...new Set([...focus, ...pool])];
    const rest = all.filter((c) => !focus.includes(c));
    const pairs = N.hardPairs(layout, all);
    const focusPairs = pairs.filter((p) => focus.includes(p[0]) || focus.includes(p[1]));
    const pairSource = focusPairs.length ? focusPairs : pairs;

    const groups = [];
    let total = 0;
    while (total + 4 < length) {
      const size = 3 + Math.floor(rng() * 4);
      const g = [];
      for (let i = 0; i < size; i++) g.push(rng() < FOCUS_SHARE || !rest.length ? pick(focus, rng) : pick(rest, rng));

      let pairAt = -1;
      if (pairSource.length && rng() < hard) {
        pairAt = Math.floor(rng() * (size - 1));
        const p = pick(pairSource, rng);
        g[pairAt] = p[0];
        g[pairAt + 1] = p[1];
      }
      if (!g.some((c) => focus.includes(c))) {
        const free = g.map((_, i) => i).filter((i) => i !== pairAt && i !== pairAt + 1);
        g[pick(free, rng)] = pick(focus, rng);
      }
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
