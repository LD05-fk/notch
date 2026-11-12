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

test("groups are 3–6 chars and each has a lesson key", () => {
  for (const id of ["home-1", "top-2", "bottom-3"]) {
    const l = lesson(id);
    for (const g of many(l, 0.3)) {
      assert.ok(g.length >= 3 && g.length <= 6, `${id}: "${g}"`);
      assert.ok([...g].some((c) => l.chars.includes(c)), `${id}: "${g}" has no lesson key`);
    }
  }
});

test("about 40% of characters come from the lesson keys", () => {
  const l = lesson("top-1");
  const chars = many(l, 0).join("");
  const share = [...chars].filter((c) => l.chars.includes(c)).length / chars.length;
  assert.ok(share > 0.4 && share < 0.6, `share ${share}`);
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
