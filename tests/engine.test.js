const test = require("node:test");
const assert = require("node:assert/strict");
const { N } = require("./helpers");

test("lesson mode: wrong key blocks, accuracy counts first tries", () => {
  const r = N.createRun("ab", "lesson");
  assert.equal(N.press(r, "x", 0).type, "miss");
  assert.equal(N.press(r, "y", 10).firstTry, false);
  assert.equal(r.pos, 0);
  assert.equal(N.press(r, "Backspace", 20).type, "none");
  const hit = N.press(r, "a", 30);
  assert.deepEqual([hit.type, hit.firstTry, r.marks[0]], ["hit", false, "fixed"]);
  assert.equal(N.press(r, "b", 40).done, true);
  assert.equal(N.runAccuracy(r), 50);
});

test("test mode: mistakes advance and Backspace works", () => {
  const r = N.createRun("ab", "test");
  N.press(r, "x", 0);
  assert.equal(r.pos, 1);
  N.press(r, "Backspace", 5);
  assert.equal(r.pos, 0);
  N.press(r, "a", 10);
  assert.equal(N.press(r, "b", 20).done, true);
});

test("wpm uses correct characters per minute", () => {
  const r = N.createRun("aaaaaaaaaa", "lesson");
  for (let i = 0; i < 10; i++) N.press(r, "a", i * 1200); // 10 chars in 10.8 s
  assert.equal(N.runWpm(r, 0), Math.round(10 / 5 / (10.8 / 60)));
});

test("pass window: last 300 characters at the target", () => {
  let w = "";
  for (let i = 0; i < 299; i++) w = N.pushWindow(w, true);
  assert.ok(!N.windowPassed(w, 97), "needs 300 characters");
  w = N.pushWindow(w, true);
  assert.ok(N.windowPassed(w, 97));
  for (let i = 0; i < 10; i++) w = N.pushWindow(w, false);
  assert.equal(w.length, 300);
  assert.ok(Math.abs(N.windowAccuracy(w) - 96.67) < 0.01);
  assert.ok(!N.windowPassed(w, 97));
});

test("recent pace looks at the last 20 characters and drops while you pause", () => {
  const times = Array.from({ length: 30 }, (_, i) => i * 250); // 4 chars/s = 48 wpm
  assert.equal(N.recentWpm(times.slice(0, 10), 2500), null, "not enough typing yet");
  assert.equal(Math.round(N.recentWpm(times, 29 * 250 + 250)), 48);
  assert.ok(N.recentWpm(times, 29 * 250 + 15000) < 15, "a pause brings it down");
});

test("recent accuracy uses the last 50 first tries", () => {
  assert.equal(N.recentAccuracy("0".repeat(100) + "1".repeat(50)), 100);
  assert.equal(N.recentAccuracy("1".repeat(48) + "00"), 96);
});

test("pace: fast and accurate is only a hint; fast and sloppy says slow down", () => {
  const base = { cap: 45, target: 97 };
  assert.equal(N.paceState({ ...base, wpm: 40, acc: 90 }), "ok", "slow is never flagged");
  assert.equal(N.paceState({ ...base, wpm: 55, acc: 98 }), "fast");
  assert.equal(N.paceState({ ...base, wpm: 55, acc: 94 }), "rushing");
  assert.equal(N.paceState({ ...base, wpm: null, acc: 50 }), "ok");
});

test("pace has a margin so it doesn't flicker around the limit", () => {
  const base = { cap: 45, target: 97, acc: 94 };
  assert.equal(N.paceState({ ...base, wpm: 44 }), "ok");
  assert.equal(N.paceState({ ...base, wpm: 44, prev: "rushing" }), "rushing", "stays until clearly slower");
  assert.equal(N.paceState({ ...base, wpm: 41, prev: "rushing" }), "ok");
});
