const test = require("node:test");
const assert = require("node:assert/strict");
const { N } = require("./helpers");

test("day keys and arithmetic", () => {
  assert.equal(N.addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(N.addDays("2026-01-01", -1), "2025-12-31");
});

test("weak keys: highest error rate over the last 7 days, learned keys only", () => {
  const s = N.freshState();
  const d = N.day(s, "2026-11-12");
  const rec = (c, n, err) => { for (let i = 0; i < n; i++) N.recordKey(d, c, i >= err); };
  rec("a", 20, 1); rec("s", 20, 4); rec("d", 20, 2); rec("f", 20, 0); rec("q", 20, 10); rec("j", 5, 5);
  N.recordKey(N.day(s, "2026-11-01"), "f", false);
  const weak = N.weakKeys(s.days, "2026-11-12", new Set("asdfj"));
  assert.deepEqual(weak.map((w) => w.key), ["s", "d", "a"]);
});

test("streaks", () => {
  const s = N.freshState();
  for (const k of ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-05"]) N.day(s, k).typedMs = 1000;
  assert.equal(N.streak(s.days, "2026-11-12"), 4);
  N.day(s, "2026-11-12").typedMs = 5;
  assert.equal(N.streak(s.days, "2026-11-12"), 5);
  assert.equal(N.longestStreak(s.days), 5);
});

test("backup round-trips and rejects other files clearly", () => {
  const s = N.freshState();
  s.lessons["home-1"] = { passedOn: "2026-11-12" };
  const back = N.readBackup(JSON.stringify(N.makeBackup(s, "2026-11-12")));
  assert.ok(back.ok);
  assert.equal(back.state.lessons["home-1"].passedOn, "2026-11-12");
  assert.equal(N.readBackup("not json").reason, "json");
  assert.equal(N.readBackup('{"name":"package"}').reason, "notNotch");
  assert.equal(N.readBackup('{"app":"notch","schema":99,"state":{}}').reason, "newer");
  assert.equal(N.readBackup('{"app":"notch","schema":1,"state":{"settings":1}}').reason, "broken");
});

test("storage keys are prefixed with notch: and old progress is moved", () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const old = N.freshState();
  old.lessons["home-1"] = { passedOn: "2026-11-12" };
  mem.set("notch", JSON.stringify(old));
  assert.equal(N.load().lessons["home-1"].passedOn, "2026-11-12");
  N.save(N.load());
  assert.deepEqual([...mem.keys()], ["notch:state"]);
  assert.ok([...mem.keys()].every((k) => k.startsWith("notch:")));
  delete globalThis.localStorage;
});
