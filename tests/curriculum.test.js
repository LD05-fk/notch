const test = require("node:test");
const assert = require("node:assert/strict");
const { N } = require("./helpers");

const hr = N.layouts["hr-qwertz"], us = N.layouts["us-qwerty"];
const words = (n) => Array.from({ length: n }, (_, i) => "ab".repeat((i % 3) + 1));
const lang = { hr: { words: [...words(120), "čaša"], sentences: ["Ana ima kuću.", "Ja sam tu.", "Idemo van.", "Sunce sja.", "Kiša pada."] } };

test("lessons follow positions; letters come from the layout", () => {
  const L = N.buildLessons(hr, ["hr"], lang);
  assert.deepEqual(L[0].chars, ["a", "s", "d", "f"]);
  assert.deepEqual(L[1].chars, ["j", "k", "l", "č"]);
  assert.deepEqual(L.find((l) => l.id === "top-5").chars, ["t", "z"]);
  assert.deepEqual(L.find((l) => l.id === "bottom-1").chars, ["y", "x", "c", "v"]);
  assert.deepEqual(L.find((l) => l.id === "pinky-1").chars, ["ć", "ž"]);
  assert.deepEqual(N.buildLessons(us, [], {})[1].chars, ["j", "k", "l", ";"]);
  assert.equal(L[0].n, 1);
});

test("combination lessons introduce no new keys", () => {
  const L = N.buildLessons(hr, ["hr"], lang);
  for (const l of L.filter((l) => l.kind === "mix")) for (const c of l.chars) assert.ok(l.pool.has(c), `${l.id}: ${c}`);
  assert.ok(!L.find((l) => l.id === "home-3").chars.includes("g"));
});

test("lessons the layout can't support are skipped", () => {
  const tiny = N.normalizeLayout({ id: "t", iso: false, base: { KeyA: "a", KeyS: "s", KeyD: "d", KeyF: "f", KeyJ: "j", KeyK: "k" } });
  const ids = N.buildLessons(tiny, [], {}).map((l) => l.id);
  assert.ok(ids.includes("home-1") && ids.includes("home-2"));
  assert.ok(!ids.includes("pinky-1") && !ids.includes("num-1") && !ids.includes("symbols"));
});

test("word lessons only use typeable words, one per practice language", () => {
  const L = N.buildLessons(us, ["hr"], lang);
  const w = L.find((l) => l.id === "words-hr");
  assert.ok(w && !w.words.includes("čaša"));
  assert.ok(!L.find((l) => l.id === "sentences"), "HR sentences need č/ć");
});

test("symbols lesson uses what the layout has, AltGr included", () => {
  const s = N.buildLessons(hr, [], {}).find((l) => l.id === "symbols");
  assert.ok(s.chars.includes("(") && s.chars.includes("{"));
  assert.ok(!s.chars.includes("-"), "already learned on HR");
});

test("unlock rule: one new lesson per day, closed after the session", () => {
  const L = N.buildLessons(hr, [], {}).slice(0, 4);
  const today = "2026-11-12";
  assert.deepEqual(N.lessonStatuses(L, {}, { today, newLessonOn: null, sessionEnded: false }), ["today", "locked", "locked", "locked"]);
  const p = { "home-1": { passedOn: today } };
  assert.deepEqual(N.lessonStatuses(L, p, { today, newLessonOn: today, sessionEnded: false }), ["passed", "tomorrow", "locked", "locked"]);
  assert.deepEqual(N.lessonStatuses(L, p, { today: "2026-11-13", newLessonOn: today, sessionEnded: false }), ["passed", "today", "locked", "locked"]);
  assert.deepEqual(N.lessonStatuses(L, p, { today: "2026-11-13", newLessonOn: today, sessionEnded: true })[1], "tomorrow");
});

test("speed warning stops after the bottom row", () => {
  const L = N.buildLessons(hr, [], {});
  assert.ok(N.speedWarnApplies(L.find((l) => l.id === "bottom-5")));
  assert.ok(!N.speedWarnApplies(L.find((l) => l.id === "all-1")));
});
