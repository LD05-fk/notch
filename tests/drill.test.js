const test = require("node:test");
const assert = require("node:assert/strict");
const { N, seeded } = require("./helpers");

const hr = N.layouts["hr-qwertz"];
const L = N.buildLessons(hr, [], {});
const lesson = (id) => L.find((l) => l.id === id);

function many(l, hard, n = 300) {
  const rng = seeded(42);
  return Array.from({ length: n }, () => N.generateDrill({ layout: hr, focus: l.chars, pool: [...l.pool], hard, rng })).join(" ").split(" ");
}

test("hard pairs: same finger other row, or top-bottom jump on one hand", () => {
  for (const p of ["de", "fr", "ki", "ec", "i,", "wx"]) assert.ok(N.isHardPair(hr, p[0], p[1]), p);
  for (const p of ["as", "fj", "ee", "dk", "ix"]) assert.ok(!N.isHardPair(hr, p[0], p[1]), p);
});

test("groups are 2–6 chars and each has a lesson key", () => {
  for (const id of ["home-1", "top-2", "bottom-3"]) {
    const l = lesson(id);
    for (const g of many(l, 0.3)) {
      assert.ok(g.length >= 2 && g.length <= 6, `${id}: "${g}"`);
      assert.ok([...g].some((c) => l.chars.includes(c)), `${id}: "${g}" has no lesson key`);
    }
  }
});

test("at least about 40% of characters come from the lesson keys", () => {
  for (const id of ["top-1", "bottom-1", "pinky-1"]) {
    const l = lesson(id);
    const chars = many(l, 0).join("");
    const share = [...chars].filter((c) => l.chars.includes(c)).length / chars.length;
    assert.ok(share > 0.35 && share < 0.6, `${id}: share ${share}`);
  }
});

const freq = (text) => {
  const n = {};
  for (const c of text.replace(/ /g, "")) n[c] = (n[c] || 0) + 1;
  return n;
};

test("every focus key is clearly more common than any other key", () => {
  const rng = seeded(5);
  for (const focus of [["d"], ["d", "f"], ["d", "f", "s"]]) {
    const text = Array.from({ length: 300 }, () => N.generateDrill({ layout: hr, focus, pool: ["a", "s", "d", "f", "j", "k", "l"], hard: 0, rng })).join(" ");
    const n = freq(text);
    const others = Object.keys(n).filter((c) => !focus.includes(c));
    for (const f of focus) for (const o of others) assert.ok(n[f] > 1.4 * n[o], `${focus}: ${f}=${n[f]} vs ${o}=${n[o]}`);
  }
});

test("a key rarely repeats right away or a third time in one group", () => {
  const rng = seeded(9);
  const groups = Array.from({ length: 500 }, () => N.generateDrill({ layout: hr, focus: ["d"], pool: ["a", "s", "f"], rng })).join(" ").split(" ");
  const share = (test) => groups.filter(test).length / groups.length;
  const doubles = share((g) => /(.)\1/.test(g));
  const triples = share((g) => /(.)\1\1/.test(g));
  const thrice = share((g) => Object.values(freq(g)).some((k) => k >= 3));
  assert.ok(doubles > 0 && doubles < 0.15, `doubles ${doubles}`);
  assert.ok(triples < 0.01, `triples ${triples}`);
  assert.ok(thrice < 0.05, `three of a key ${thrice}`);
});

test("group lengths peak at 4 and fall off symmetrically", () => {
  const rng = seeded(11);
  const groups = Array.from({ length: 1000 }, () => N.generateDrill({ layout: hr, focus: ["a", "s"], pool: ["d", "f", "j", "k"], hard: 0, rng })).join(" ").split(" ");
  const n = {};
  for (const g of groups) n[g.length] = (n[g.length] || 0) + 1;
  const share = (k) => n[k] / groups.length;
  assert.ok(share(4) > 0.33 && share(4) < 0.47, `4: ${share(4)}`);
  for (const k of [3, 5]) assert.ok(share(k) > 0.14 && share(k) < 0.26, `${k}: ${share(k)}`);
  for (const k of [2, 6]) assert.ok(share(k) > 0.05 && share(k) < 0.15, `${k}: ${share(k)}`);
});

test("a round does not repeat a group", () => {
  const rng = seeded(13);
  for (let i = 0; i < 200; i++) {
    const gs = N.generateDrill({ layout: hr, focus: ["a", "s", "d", "f"], pool: [], rng }).split(" ");
    assert.equal(new Set(gs).size, gs.length, gs.join(" "));
  }
});

test("hard transitions appear in roughly the requested share of groups", () => {
  const l = lesson("top-1");
  const hasHard = (g) => [...g].some((c, i) => i && N.isHardPair(hr, g[i - 1], c));
  const share = (hard) => { const gs = many(l, hard); return gs.filter(hasHard).length / gs.length; };
  assert.ok(share(0.45) >= 0.45, `combination share ${share(0.45)}`);
  assert.ok(share(0.3) >= 0.3 && share(0.3) < share(0.45));
});

test("only learned characters are used", () => {
  const l = lesson("top-1");
  for (const c of many(l, 0.3).join("")) assert.ok(l.pool.has(c), c);
});

test("rounds are about 70 characters", () => {
  const rng = seeded(7);
  for (let i = 0; i < 200; i++) {
    const t = N.generateDrill({ layout: hr, focus: ["a", "s"], pool: ["d", "f"], rng });
    assert.ok(t.length >= 66 && t.length <= 76, t.length);
  }
});

test("caps option capitalises some group starts", () => {
  const t = N.generateDrill({ layout: hr, focus: ["a", "s"], pool: ["d", "f"], caps: 1, rng: seeded(3) });
  assert.ok(t.split(" ").every((g) => g[0] === g[0].toUpperCase()));
});
