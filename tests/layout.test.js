const test = require("node:test");
const assert = require("node:assert/strict");
const { N } = require("./helpers");

const hr = N.layouts["hr-qwertz"], us = N.layouts["us-qwerty"];

test("characters map to physical keys and fingers", () => {
  assert.deepEqual(N.keyFor(hr, "č"), { code: "Semicolon", layer: "base", finger: "rp", row: 2 });
  assert.equal(N.keyFor(hr, "z").code, "KeyY");
  assert.equal(N.keyFor(us, "z").code, "KeyZ");
  assert.equal(N.keyFor(hr, "f").finger, N.keyFor(us, "f").finger);
});

test("shift and altgr layers", () => {
  assert.deepEqual([N.keyFor(hr, "Č").code, N.keyFor(hr, "Č").layer], ["Semicolon", "shift"]);
  assert.deepEqual([N.keyFor(hr, "(").code, N.keyFor(hr, "(").layer], ["Digit8", "shift"]);
  assert.deepEqual([N.keyFor(hr, "[").code, N.keyFor(hr, "[").layer], ["KeyF", "altgr"]);
  assert.equal(N.keyFor(us, "{").code, "BracketLeft");
});

test("dead keys and ISO-only keys are left out", () => {
  assert.equal(hr.base.Backquote, undefined);
  const ansi = N.normalizeLayout({ id: "x", iso: false, base: { IntlBackslash: "<", KeyA: "a" } });
  assert.equal(ansi.base.IntlBackslash, undefined);
  assert.equal(ansi.shift.KeyA, "A");
});

test("opposite shift: left-hand letter wants right Shift", () => {
  assert.equal(N.oppositeShift(hr, "A"), "ShiftRight");
  assert.equal(N.oppositeShift(hr, "Ž"), "ShiftLeft");
});

test("canType", () => {
  assert.ok(N.canType(hr, "čaša vode"));
  assert.ok(!N.canType(us, "čaša"));
});
