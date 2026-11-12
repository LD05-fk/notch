/* Notch core: the global namespace, self-registration for layouts and
   languages, and the physical keyboard every layout is drawn on.
   Plain functions only, so Node tests can load this file as-is. */
var Notch = (globalThis.Notch = globalThis.Notch || {});

Notch.layouts = Notch.layouts || {};
Notch.ui = Notch.ui || {};
Notch.words = Notch.words || {};

/* Index files (layouts/index.js, languages/index.js) list what exists, so
   first run can offer a choice without loading every file. */
Notch.layoutIndex = Notch.layoutIndex || [];
Notch.languageIndex = Notch.languageIndex || [];

/* ---------- Physical keyboard, by KeyboardEvent.code ---------- */

/* [code, width]. Row 0 numbers, 1 top, 2 home, 3 bottom, 4 space. */
Notch.ROWS = [
  [["Backquote"], ["Digit1"], ["Digit2"], ["Digit3"], ["Digit4"], ["Digit5"], ["Digit6"], ["Digit7"], ["Digit8"], ["Digit9"], ["Digit0"], ["Minus"], ["Equal"], ["Backspace", 1.8]],
  [["Tab", 1.5], ["KeyQ"], ["KeyW"], ["KeyE"], ["KeyR"], ["KeyT"], ["KeyY"], ["KeyU"], ["KeyI"], ["KeyO"], ["KeyP"], ["BracketLeft"], ["BracketRight"], ["EnterTop", 1.3]],
  [["CapsLock", 1.8], ["KeyA"], ["KeyS"], ["KeyD"], ["KeyF"], ["KeyG"], ["KeyH"], ["KeyJ"], ["KeyK"], ["KeyL"], ["Semicolon"], ["Quote"], ["Backslash"], ["Enter", 1]],
  [["ShiftLeft", 1.3], ["IntlBackslash"], ["KeyZ"], ["KeyX"], ["KeyC"], ["KeyV"], ["KeyB"], ["KeyN"], ["KeyM"], ["Comma"], ["Period"], ["Slash"], ["ShiftRight", 2.4]],
  [["gap", 3.2], ["Space", 6], ["AltRight", 1.4], ["gap", 1.8]],
];

/* Keys that never produce a practice character. */
Notch.FUNCTION_KEYS = ["Backspace", "Tab", "EnterTop", "CapsLock", "Enter", "ShiftLeft", "ShiftRight", "Space", "AltRight", "gap"];

/* Standard touch-typing finger for each physical key; layout-independent. */
Notch.FINGER_KEYS = {
  lp: "Backquote Digit1 KeyQ KeyA IntlBackslash KeyZ ShiftLeft",
  lr: "Digit2 KeyW KeyS KeyX",
  lm: "Digit3 KeyE KeyD KeyC",
  li: "Digit4 Digit5 KeyR KeyT KeyF KeyG KeyV KeyB",
  ri: "Digit6 Digit7 KeyY KeyU KeyH KeyJ KeyN KeyM",
  rm: "Digit8 KeyI KeyK Comma",
  rr: "Digit9 KeyO KeyL Period",
  rp: "Digit0 Minus Equal KeyP BracketLeft BracketRight Semicolon Quote Backslash Slash ShiftRight",
  th: "Space AltRight",
};
Notch.FINGERS = ["lp", "lr", "lm", "li", "ri", "rm", "rr", "rp"];

Notch.FINGER_OF = {};
Notch.ROW_OF = {};
for (const f in Notch.FINGER_KEYS) for (const code of Notch.FINGER_KEYS[f].split(" ")) Notch.FINGER_OF[code] = f;
Notch.ROWS.forEach((row, i) => row.forEach(([code]) => (Notch.ROW_OF[code] = i)));

/* Every key that can carry a character, in calibration order. */
Notch.CHAR_CODES = Notch.ROWS.flat().map(([c]) => c).filter((c) => !Notch.FUNCTION_KEYS.includes(c));

Notch.isLeft = (finger) => finger[0] === "l";

/* ---------- Layouts ---------- */

/* A layout: { id, name, iso, base:{code:char}, shift:{code:char}, altgr:{code:char}, dead:[code] }.
   shift is optional: a letter without an entry shifts to its upper case. */
Notch.registerLayout = function (layout) {
  Notch.layouts[layout.id] = normalizeLayout(layout);
};

function normalizeLayout(l) {
  const base = {}, shift = {}, altgr = {};
  const dead = l.dead || [];
  for (const code of Notch.CHAR_CODES) {
    if (!l.iso && code === "IntlBackslash") continue;
    if (dead.includes(code)) continue;
    const b = l.base[code];
    if (b) {
      base[code] = b;
      const s = (l.shift && l.shift[code]) || (b.toUpperCase() !== b ? b.toUpperCase() : "");
      if (s) shift[code] = s;
    }
    if (l.altgr && l.altgr[code]) altgr[code] = l.altgr[code];
  }
  const keyOf = {};
  /* Base is written last, so a char reachable without modifiers keeps its plain key. */
  for (const [layer, map] of [["altgr", altgr], ["shift", shift], ["base", base]])
    for (const code in map) keyOf[map[code]] = { code, layer };
  return { id: l.id, name: l.name, iso: !!l.iso, base, shift, altgr, dead, keyOf };
}
Notch.normalizeLayout = normalizeLayout;

/* Where a character lives on a layout: { code, layer, finger, row } or null. */
Notch.keyFor = function (layout, ch) {
  if (ch === " ") return { code: "Space", layer: "base", finger: "th", row: 4 };
  const k = layout.keyOf[ch];
  return k ? { ...k, finger: Notch.FINGER_OF[k.code], row: Notch.ROW_OF[k.code] } : null;
};

Notch.canType = (layout, text) => [...text].every((c) => Notch.keyFor(layout, c));

/* The Shift a character should be typed with: the one on the other hand. */
Notch.oppositeShift = (layout, ch) => {
  const k = Notch.keyFor(layout, ch);
  return k && Notch.isLeft(k.finger) ? "ShiftRight" : "ShiftLeft";
};

/* ---------- Languages ---------- */

Notch.registerUI = function (code, strings) {
  Notch.ui[code] = strings;
};
Notch.registerWords = function (code, data) {
  Notch.words[code] = data;
};

/* Current interface strings; falls back to English, then to the key itself. */
Notch.lang = "en";
Notch.t = function (key, vars) {
  const s = (Notch.ui[Notch.lang] && Notch.ui[Notch.lang][key]) ?? (Notch.ui.en && Notch.ui.en[key]) ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`)) : s;
};
