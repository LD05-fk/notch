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
