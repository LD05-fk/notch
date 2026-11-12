/* The curriculum is written in physical positions; buildLessons() turns it
   into concrete characters for one layout and drops lessons the layout
   can't support. */
(function (N) {
  const LH_HOME = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"];
  const LH_TOP = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT"];
  const LH_BOT = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB"];
  const RH_HOME = ["KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"];
  const RH_TOP = ["KeyY", "KeyU", "KeyI", "KeyO", "KeyP"];
  const RH_BOT = ["KeyN", "KeyM", "Comma", "Period", "Slash"];

  /* Code symbols, most useful first; a lesson takes the ones the layout has. */
  const SYMBOLS = "( ) { } [ ] = ; : < > + - * / & | _ ! \"".split(" ");
  const MAX_SYMBOLS = 14;
  const MIN_WORDS = 100;

  /* keys: introduces new positions. mix: no new keys, only combines learned ones. */
  N.CURRICULUM = [
    { module: "home", lessons: [
      { id: "home-1", keys: ["KeyA", "KeyS", "KeyD", "KeyF"] },
      { id: "home-2", keys: ["KeyJ", "KeyK", "KeyL", "Semicolon"] },
      { id: "home-3", mix: [...LH_HOME, ...RH_HOME] },
      { id: "home-4", keys: ["KeyG", "KeyH"] },
    ] },
    { module: "top", lessons: [
      { id: "top-1", keys: ["KeyQ", "KeyW", "KeyE", "KeyR"] },
      { id: "top-2", mix: [...LH_HOME, ...LH_TOP] },
      { id: "top-3", keys: ["KeyU", "KeyI", "KeyO", "KeyP"] },
      { id: "top-4", mix: [...RH_HOME, ...RH_TOP] },
      { id: "top-5", keys: ["KeyT", "KeyY"] },
    ] },
    { module: "bottom", lessons: [
      { id: "bottom-1", keys: ["KeyZ", "KeyX", "KeyC", "KeyV"] },
      { id: "bottom-2", mix: [...LH_HOME, ...LH_TOP, ...LH_BOT] },
      { id: "bottom-3", keys: ["KeyM", "Comma", "Period", "Slash"] },
      { id: "bottom-4", mix: [...RH_HOME, ...RH_TOP, ...RH_BOT] },
      { id: "bottom-5", keys: ["KeyB", "KeyN"] },
    ] },
    { module: "all", lessons: [
      { id: "all-1", mix: [...LH_HOME, ...LH_TOP, ...LH_BOT, ...RH_HOME, ...RH_TOP, ...RH_BOT] },
    ] },
    { module: "caps", lessons: [{ id: "caps", caps: true }] },
    { module: "pinky", lessons: [
      { id: "pinky-1", keys: ["Quote", "Backslash"] },
      { id: "pinky-2", keys: ["BracketLeft", "BracketRight"] },
      { id: "pinky-3", mix: ["Semicolon", "Quote", "Backslash", "BracketLeft", "BracketRight", "KeyL", "KeyO", "KeyP", "KeyK"] },
    ] },
    { module: "numbers", lessons: [
      { id: "num-1", keys: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"] },
      { id: "num-2", keys: ["Digit6", "Digit7", "Digit8", "Digit9", "Digit0"] },
    ] },
    { module: "symbols", lessons: [{ id: "symbols", symbols: true }] },
    { module: "words", lessons: [{ id: "words", words: true }, { id: "sentences", sentences: true }] },
  ];

  /* Speed warnings apply up to the end of this module. */
  N.SPEED_WARN_LAST_MODULE = "bottom";

  /* Concrete lessons for a layout and a set of practice languages.
     Each: { id, module, n, kind, chars, pool, lang?, words?, sentences?, caps } */
  N.buildLessons = function (layout, langs, words) {
    const learned = new Set();
    let caps = false;
    const out = [];
    const add = (lesson) => out.push({ ...lesson, n: out.length + 1, pool: new Set(learned), caps });

    for (const mod of N.CURRICULUM) {
      for (const def of mod.lessons) {
        const base = { id: def.id, module: mod.module };
        if (def.keys) {
          const chars = def.keys.map((c) => layout.base[c]).filter(Boolean);
          if (!chars.length) continue;
          chars.forEach((c) => learned.add(c));
          add({ ...base, kind: "keys", chars });
        } else if (def.mix) {
          const chars = def.mix.map((c) => layout.base[c]).filter((c) => c && learned.has(c));
          if (chars.length < 2) continue;
          add({ ...base, kind: "mix", chars });
        } else if (def.caps) {
          const chars = [...learned].filter(isLetter).map((c) => layout.shift[layout.keyOf[c].code]).filter(Boolean);
          if (!chars.length) continue;
          add({ ...base, kind: "caps", chars });
          caps = true;
        } else if (def.symbols) {
          const chars = SYMBOLS.filter((c) => N.keyFor(layout, c) && !learned.has(c)).slice(0, MAX_SYMBOLS);
          if (chars.length < 4) continue;
          chars.forEach((c) => learned.add(c));
          add({ ...base, kind: "symbols", chars });
        } else if (def.words) {
          for (const lang of langs) {
            const list = ((words[lang] && words[lang].words) || []).filter((w) => N.canType(layout, w));
            if (list.length < MIN_WORDS) continue;
            add({ id: `words-${lang}`, module: mod.module, kind: "words", lang, words: list, chars: [] });
          }
        } else if (def.sentences) {
          const list = langs.flatMap((lang) => (words[lang] && words[lang].sentences) || []).filter((s) => N.canType(layout, s));
          if (list.length < 5) continue;
          add({ ...base, kind: "sentences", sentences: list, chars: [] });
        }
      }
    }
    return out;
  };

  function isLetter(c) {
    return c.toLowerCase() !== c.toUpperCase();
  }

  /* Status of each lesson today: passed | today | tomorrow | locked.
     The first lesson not yet passed is the only candidate; it opens if no new
     lesson was passed today and today's session hasn't ended. */
  N.lessonStatuses = function (lessons, lessonProgress, { today, newLessonOn, sessionEnded }) {
    let candidateSeen = false;
    return lessons.map((l) => {
      const p = lessonProgress[l.id];
      if (p && p.passedOn) return "passed";
      if (candidateSeen) return "locked";
      candidateSeen = true;
      return newLessonOn === today || sessionEnded ? "tomorrow" : "today";
    });
  };

  N.speedWarnApplies = function (lesson) {
    const order = N.CURRICULUM.map((m) => m.module);
    return order.indexOf(lesson.module) <= order.indexOf(N.SPEED_WARN_LAST_MODULE);
  };
})(Notch);
