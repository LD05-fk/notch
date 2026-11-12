/* Notch UI: boot, session clock, views and the typing loop.
   Logic lives in the other src/ files; this file wires it to the page. */
(function (N) {
  const t = N.t;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fmt = (n, digits = 1) => new Intl.NumberFormat(N.lang, { maximumFractionDigits: digits }).format(n);
  const pct = (n) => (n == null ? "—" : fmt(n) + "%");
  const plural = (key, n) => {
    const form = new Intl.PluralRules(N.lang).select(n);
    const k = N.ui[N.lang] && N.ui[N.lang][`${key}.${form}`] ? `${key}.${form}` : `${key}.other`;
    return t(k, { n: fmt(n, 0) });
  };

  /* ---------- Session plan ---------- */

  const SESSION = 1800;
  const PHASES = [
    { id: "warmup", end: 300, min: 5 },
    { id: "lesson", end: 1200, min: 15 },
    { id: "weak", end: 1620, min: 7 },
    { id: "test", end: 1800, min: 3 },
  ];
  const IDLE_MS = 10000;
  const ROUND = 70;
  const HARD = { normal: 0.3, mix: 0.45 };
  const CAPS_IN_MIX = 0.1;
  const TEST_LENGTHS = [30, 60];

  const phaseIndex = (sec) => {
    const i = PHASES.findIndex((p) => sec < p.end);
    return i < 0 ? PHASES.length - 1 : i;
  };

  /* ---------- App state ---------- */

  const A = {
    state: N.load(),
    layout: null,
    lessons: [],
    route: "today",
    param: null,
    drill: null, // { kind: "session" | "lesson" | "review", id? }
    round: null, // current round: { run, kind, lesson, focus, label, windowed, shiftWarn, n }
    roundNo: 0,
    lastKeyAt: 0,
    heldShift: null,
    pace: null, // { times, results, state }: recent typing, kept across rounds
    test: { lang: null, dur: 30, timer: null, left: 30 },
    setup: null,
    overlay: null,
  };
  const S = () => A.state;
  const today = () => N.dayKey();
  const day = () => N.day(S(), today());
  const sessionEnded = () => day().session >= SESSION;
  const save = () => N.save(S());

  /* ---------- Loading layouts and languages ---------- */

  const loaded = new Set();
  function loadScript(src) {
    if (loaded.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => { loaded.add(src); resolve(); };
      s.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.append(s);
    });
  }
  const loadUI = (code) => loadScript(`languages/${code}/ui.js`);
  const loadWords = (code) => loadScript(`languages/${code}/words.js`);
  const loadLayout = (id) => (id === "custom" ? Promise.resolve() : loadScript(`layouts/${id}.js`));

  function guessUI() {
    const codes = N.languageIndex.map((l) => l.code);
    const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    return codes.includes(nav) ? nav : codes.includes("en") ? "en" : codes[0];
  }

  /* config.local.js only seeds settings that were never saved. */
  function applyConfig() {
    const c = N.config;
    const st = S().settings;
    if (!c || st.setupDone) return;
    if (c.layout) st.layout = c.layout;
    if (c.ui) st.ui = c.ui;
    if (c.practice) st.practice = [...c.practice];
    if (c.rules) Object.assign(S().rules, c.rules);
    if (c.skipSetup && st.layout && st.ui && st.practice.length) st.setupDone = true;
  }

  async function boot() {
    applyConfig();
    const st = S().settings;
    if (!st.ui) st.ui = guessUI();
    await loadUI(st.ui).catch(() => loadUI((st.ui = "en")));
    N.lang = st.ui;
    if (st.setupDone) {
      try {
        await useSettings();
      } catch (err) {
        console.error(err);
        st.setupDone = false; // a layout or language went missing: ask again
      }
    }
    if (!st.setupDone) startSetup();
    window.addEventListener("hashchange", onRoute);
    setInterval(tick, 1000);
    onRoute();
  }

  /* Load what the settings name and rebuild everything derived from them. */
  async function useSettings() {
    const st = S().settings;
    await Promise.all([loadUI(st.ui), loadLayout(st.layout), ...st.practice.map(loadWords)]);
    N.lang = st.ui;
    document.documentElement.lang = st.ui;
    if (st.layout === "custom") N.registerLayout({ ...S().customLayout, id: "custom" });
    A.layout = N.layouts[st.layout];
    if (!A.layout) throw new Error(`Unknown layout ${st.layout}`);
    A.lessons = N.buildLessons(A.layout, st.practice, N.words);
    if (!st.practice.includes(A.test.lang)) A.test.lang = st.practice[0];
    A.drill = null;
    A.round = null;
  }

  /* ---------- Derived progress ---------- */

  function statuses() {
    return N.lessonStatuses(A.lessons, S().lessons, { today: today(), newLessonOn: S().newLessonOn, sessionEnded: sessionEnded() });
  }
  const statusOf = (lesson) => statuses()[A.lessons.indexOf(lesson)];
  const lessonById = (id) => A.lessons.find((l) => l.id === id);
  const lessonProgress = (id) => (S().lessons[id] ||= { window: "", rounds: 0, passedOn: null, roundsToPass: null, bestAcc: 0, bestWpm: 0 });
  const currentLesson = () => A.lessons[statuses().findIndex((s) => s !== "passed")] || null;

  /* Everything learned: the pool of the last passed lesson. */
  function learned() {
    const st = statuses();
    let last = -1;
    st.forEach((s, i) => { if (s === "passed") last = i; });
    if (last < 0) return new Set(A.lessons[0] ? A.lessons[0].chars : []);
    return A.lessons[last].pool;
  }
  const capsLearned = () => A.lessons.some((l, i) => l.kind === "caps" && statuses()[i] === "passed");
  const weakKeys = () => N.weakKeys(S().days, today(), learned());

  /* ---------- Session clock: counts only while typing ---------- */

  const typingView = () => A.route === "practice" || A.route === "test";
  const idle = () => Date.now() - A.lastKeyAt > IDLE_MS;

  function tick() {
    const d = day();
    if (S().settings.setupDone && typingView() && !idle() && d.session < SESSION && !A.overlay) {
      d.session++;
      save();
      if (d.session >= SESSION) endSession();
    }
    drawSession();
  }

  function endSession() {
    if (A.round && A.round.windowed && statusOf(A.round.lesson) !== "passed") {
      A.round = null;
      A.drill = { kind: "review" };
    }
    if (A.route === "practice" || A.route === "today" || A.route === "lessons" || A.route === "lesson") render();
  }

  function drawSession() {
    const el = $("session");
    if (!S().settings.setupDone || A.route === "setup") { el.hidden = true; return; }
    el.hidden = false;
    const sec = Math.min(day().session, SESSION), ended = sec >= SESSION;
    const i = phaseIndex(sec);
    $("segs").innerHTML = PHASES.map((p, j) => {
      const start = j ? PHASES[j - 1].end : 0;
      const cls = ended || j < i ? "done" : j === i ? "cur" : "";
      return `<div class="seg ${cls}" style="flex:${p.min};--p:${(sec - start) / (p.end - start)}"><b></b></div>`;
    }).join("");
    const left = SESSION - sec;
    $("sess-label").innerHTML = ended
      ? `<b>${t("session.done")}</b> · ${t("session.doneNote")}`
      : `<b>${t("session")}</b> · ${t("phase." + PHASES[i].id)}${typingView() && idle() ? ` · <span class="paused">${t("session.paused")}</span>` : ""}`;
    $("sess-time").textContent = ended ? "" : t("session.left", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` });
  }

  /* ---------- Routing and chrome ---------- */

  const TABS = ["today", "practice", "lessons", "test", "stats", "settings"];

  function onRoute() {
    const [route, param] = (location.hash.slice(1) || "today").split("/");
    stopTestTimer();
    A.route = V[route] ? route : "today";
    A.param = param ? decodeURIComponent(param) : null;
    if (!S().settings.setupDone && A.route !== "setup") return go("setup");
    if (A.route !== "practice") A.round = null;
    A.pace = { times: [], results: "", state: "ok" };
    if (A.route === "test") newTest();
    render();
  }
  const go = (route) => { if (location.hash === "#" + route) onRoute(); else location.hash = route; };

  function drawChrome() {
    const setupMode = !S().settings.setupDone;
    $("tabs").innerHTML = setupMode ? "" : TABS.map((k) => `<a href="#${k}" aria-current="${k === A.route || (k === "lessons" && A.route === "lesson") ? "page" : "false"}">${t("tab." + k)}</a>`).join("");
    $("tabs").hidden = setupMode;
    $("ui-lang").setAttribute("aria-label", t("uiLanguage"));
    $("ui-lang").innerHTML = N.languageIndex.length > 1 ? N.languageIndex.map((l) => `<button data-ui="${l.code}" aria-pressed="${l.code === N.lang}" title="${esc(l.name)}">${l.code.toUpperCase()}</button>`).join("") : "";
  }

  function render() {
    closeOverlay();
    drawChrome();
    $("view").innerHTML = V[A.route]();
    if (W[A.route]) W[A.route]();
    drawSession();
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ui]");
    if (!b) return;
    const code = b.dataset.ui;
    await loadUI(code);
    N.lang = code;
    document.documentElement.lang = code;
    if (A.setup) A.setup.ui = code;
    if (S().settings.setupDone) { S().settings.ui = code; save(); }
    render();
  });

  /* ---------- On-screen keyboard ---------- */

  const FIXED = { Backspace: "⌫", Tab: "Tab", EnterTop: "", CapsLock: "Caps", Enter: "Enter", ShiftLeft: "Shift", ShiftRight: "Shift", AltRight: "AltGr" };

  /* opts: { layout, id, cls, pool (dims keys outside it), mark (highlights), label(code, ch), showEmpty } */
  function keyboard({ layout = A.layout, id = "kb", cls = "", pool, mark, label, showEmpty = false } = {}) {
    const hasAltGr = layout && Object.keys(layout.altgr || {}).length > 0;
    const iso = layout ? layout.iso : true;
    let h = `<div class="kb ${cls}" id="${id}">`;
    for (const row of N.ROWS) {
      h += '<div class="row">';
      for (let [code, w = 1] of row) {
        if (code === "gap" || (code === "AltRight" && !hasAltGr)) { h += `<div style="flex:${w} 1 0"></div>`; continue; }
        if (code === "IntlBackslash" && !iso) continue;
        if (code === "ShiftLeft" && !iso) w = 2.3;
        const f = N.FINGER_OF[code];
        const fixed = code in FIXED || code === "Space";
        const ch = fixed ? null : (layout && layout.base[code]) || "";
        let c = "key";
        if (code === "KeyF" || code === "KeyJ") c += " home";
        if (pool && ch && !pool.has(ch) && !(mark && mark.has(ch))) c += " locked";
        if (mark && ch && mark.has(ch)) c += " newk";
        if (!fixed && !ch) c += " empty";
        const inner = label ? label(code, ch) : code === "Space" ? `<small>${t("key.space")}</small>` : fixed ? `<small>${FIXED[code]}</small>` : esc(ch || (showEmpty ? "·" : ""));
        h += `<div class="${c}" style="--w:${w};${f ? `--fc:var(--f-${f})` : ""}" ${f ? `data-f="${f}"` : ""} data-code="${code}">${inner}</div>`;
      }
      h += "</div>";
    }
    return h + "</div>";
  }
  const legend = () => `<div class="kb-legend">${N.FINGERS.map((f) => `<span><i class="swatch" style="background:var(--f-${f})"></i>${t("finger." + f)}</span>`).join("")}</div>`;
  const keyEl = (code, id = "kb") => document.querySelector(`#${id} [data-code="${code}"]`);

  function flashKey(ch) {
    const k = N.keyFor(A.layout, ch), el = k && keyEl(k.code);
    if (!el) return;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 220);
  }

  /* ---------- Views ---------- */

  const V = {}, W = {}; // V: html for a route, W: wiring after it's in the page

  /* Today */
  V.today = () => {
    const d = day(), sec = Math.min(d.session, SESSION), ended = sec >= SESSION, pi = phaseIndex(sec);
    const L = currentLesson(), st = L ? statusOf(L) : null;
    const weak = weakKeys();
    const desc = [
      t("plan.warmup"),
      ended ? t("plan.lessonLocked")
        : !L ? t("plan.allDone")
        : st === "tomorrow" ? t("plan.lessonUsed")
        : `${lessonHeading(L)} · ${t("plan.target", { acc: S().rules.acc })}`,
      weak.length ? t("plan.weak", { keys: weak.map((w) => esc(w.key)).join(", ") }) : t("plan.weakNoData"),
      t("plan.test"),
    ];
    const stats7 = N.periodStats(S().days, today(), 7);
    const passed = statuses().filter((s) => s === "passed").length;
    const streak = N.streak(S().days, today());
    const dateLabel = new Intl.DateTimeFormat(N.lang, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    return `<div class="grid g2">
      <section class="panel" style="display:grid;gap:14px">
        <div><div class="label">${esc(dateLabel)}</div><h1>${t("today.title")}</h1>
        <p class="muted" style="margin:4px 0 0;font-size:.88rem">${t("today.clockNote")}</p></div>
        <div class="plan">${PHASES.map((p, j) => {
          const done = ended || j < pi, now = !ended && j === pi;
          return `<div class="plan-item ${done ? "done" : now ? "now" : ""}"><span class="min num">${p.min}′</span><div><b>${t("phase." + p.id)}</b><div class="muted" style="font-size:.82rem">${desc[j]}</div></div>
          ${done ? '<span class="chip good">✓</span>' : now ? `<a class="btn primary" href="#${p.id === "test" ? "test" : "practice"}">${sec > 0 ? t("continue") : t("start")}</a>` : `<span class="chip">${t("plan.next")}</span>`}</div>`;
        }).join("")}</div>
        ${ended ? `<div class="row-btns" style="justify-content:flex-start"><a class="btn" href="#practice">${t("review")}</a><a class="btn" href="#test">${t("tab.test")}</a></div>` : ""}
      </section>
      <div class="grid" style="align-content:start">
        <section class="panel" style="display:grid;gap:10px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h2>${t("streak")}</h2><span class="chip acc num">${plural("streak.days", streak)}</span></div>
          ${calendar(15)}
        </section>
        <section class="panel" style="display:grid;gap:10px">
          <h2>${t("progress")}</h2>
          <div class="meters">
            <div class="meter"><div class="v num">${stats7.wpm == null ? "—" : fmt(stats7.wpm, 0)}</div><div class="k">${t("progress.wpm7")}</div></div>
            <div class="meter"><div class="v num">${pct(stats7.acc)}</div><div class="k">${t("progress.acc7")}</div></div>
            <div class="meter"><div class="v num">${passed}/${A.lessons.length}</div><div class="k">${t("progress.lessons")}</div></div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span class="label">${t("weakest")}</span>
            ${weak.length ? weak.map((w, i) => `<span class="chip ${i ? "warn" : "bad"}">${esc(w.key)} ${pct(w.rate)}</span>`).join("") : `<span class="note">${t("weakest.none")}</span>`}</div>
        </section>
      </div></div>`;
  };

  /* Practice */
  function lessonHeading(L) {
    const keys = `<span class="kn">${esc(lessonKeys(L))}</span>`;
    if (L.kind === "keys") return `${t("newKeys")} ${keys}`;
    if (L.kind === "mix") return `${t("combinations")} ${keys}`;
    return lessonTitle(L);
  }
  const lessonKeys = (L) => (L.kind === "words" || L.kind === "sentences" ? "" : L.chars.join(" "));
  function lessonTitle(L) {
    if (L.kind === "words") return t("lesson.words", { lang: langName(L.lang) });
    const key = "lesson." + L.id;
    return N.t(key) === key ? "" : N.t(key);
  }
  const langName = (code) => (N.languageIndex.find((l) => l.code === code) || { name: code }).name;

  /* Decide what the next round is, from the current drill. */
  function nextRound() {
    const d = A.drill || (A.drill = { kind: "session" });
    if (d.kind === "lesson") {
      const L = lessonById(d.id);
      if (L && ["today", "passed"].includes(statusOf(L))) return lessonRound(L);
      A.drill = { kind: sessionEnded() ? "review" : "session" };
      return nextRound();
    }
    if (d.kind === "review" || sessionEnded()) return mixRound("review");
    const phase = PHASES[phaseIndex(day().session)].id;
    if (phase === "warmup") return mixRound("warmup");
    if (phase === "lesson") {
      const L = currentLesson();
      return L && statusOf(L) === "today" ? lessonRound(L) : mixRound("review");
    }
    if (phase === "weak") return weakRound();
    return null; // test phase
  }

  function lessonRound(L) {
    let text;
    if (L.kind === "words") text = N.wordsText(L.words, ROUND);
    else if (L.kind === "sentences") text = N.sentencesText(L.sentences, ROUND);
    else text = N.generateDrill({ layout: A.layout, focus: L.chars, pool: [...L.pool], length: ROUND, hard: L.kind === "mix" ? HARD.mix : HARD.normal, caps: L.caps ? CAPS_IN_MIX : 0 });
    return { kind: "lesson", lesson: L, text, windowed: true, pool: new Set([...L.pool, ...L.chars]) };
  }
  function mixRound(kind) {
    const pool = [...learned()];
    return { kind, lesson: currentLesson() || A.lessons[A.lessons.length - 1], pool: new Set(pool), text: N.generateDrill({ layout: A.layout, focus: pool, pool, length: ROUND, hard: HARD.mix, caps: capsLearned() ? CAPS_IN_MIX : 0 }) };
  }
  function weakRound() {
    const weak = weakKeys().map((w) => w.key);
    const pool = [...learned()];
    const focus = weak.length ? weak : pool;
    return { kind: "weak", weak, lesson: currentLesson() || A.lessons[A.lessons.length - 1], pool: new Set(pool), text: N.generateDrill({ layout: A.layout, focus, pool, length: ROUND, hard: HARD.normal, caps: capsLearned() ? CAPS_IN_MIX : 0 }) };
  }

  function startRound() {
    const r = nextRound();
    if (!r) { go("test"); return false; }
    const same = A.round && A.round.kind === r.kind && A.round.lesson === r.lesson;
    A.roundNo = same ? A.roundNo + 1 : 1;
    const hasShift = [...r.text].some((c) => { const k = N.keyFor(A.layout, c); return k && k.layer === "shift"; });
    A.round = { ...r, run: N.createRun(r.text, "lesson"), shiftWarn: 0, hasShift, n: A.roundNo };
    return true;
  }

  V.practice = () => {
    if (!A.round && !startRound()) return "";
    const R = A.round, L = R.lesson;
    const head = R.kind === "lesson" ? lessonHeading(L)
      : R.kind === "weak" ? `${t("phase.weak")}${R.weak.length ? ` <span class="kn">${esc(R.weak.join(" "))}</span>` : ""}`
      : t(R.kind === "warmup" ? "phase.warmup" : "review");
    const label = R.kind === "lesson"
      ? `${t("module." + L.module)} · ${t("lesson")} ${L.n} · ${t("round")} ${R.n}`
      : `${t("session")} · ${t("round")} ${R.n}`;
    const win = R.windowed ? lessonProgress(L.id).window : "";
    const ended = sessionEnded();
    return `<div class="lesson-head">
      <div><div class="label">${label}</div><h1>${head}</h1></div>
      <div class="meters">
        <div class="meter pace" id="m-pace"><div class="v num" id="m-wpm">0</div><div class="k" id="m-wpm-k">wpm</div></div>
        <div class="meter"><div class="v num" id="m-acc">100%</div><div class="k">${t("roundAccuracy")}</div></div>
        ${R.hasShift && S().rules.oppositeShift ? `<div class="meter" id="m-shift" title="${esc(t("shift.note"))}"><div class="v num" id="m-shift-n">0×</div><div class="k">${t("shift.label")}</div></div>` : ""}
      </div></div>
    ${ended ? `<div class="alert info" style="margin:0 0 10px">${t("practice.sessionDone")}</div>` : ""}
    ${R.windowed ? `<div class="window"><div style="display:flex;justify-content:space-between;font-size:.8rem;gap:8px;flex-wrap:wrap"><span>${t("window.note", { n: N.WINDOW, acc: S().rules.acc })}</span><span class="num"><b id="w-acc">${pct(N.windowAccuracy(win))}</b> · <span id="w-n">${win.length}</span>/${N.WINDOW}</span></div><div class="window-bar"><b id="w-bar" style="width:${(100 * win.length) / N.WINDOW}%"></b></div></div>` : ""}
    <div class="strip blur" id="strip" data-hint="${esc(t("practice.startHint"))}"></div>
    <div class="finger-hint" id="hint"></div>
    ${S().rules.noLook ? `<div class="nolook">${t("practice.noLook")}</div>`
      : `<div class="kb-wrap">${keyboard({ cls: S().rules.fingerColors ? "fingers" : "", pool: R.pool })}</div>${S().rules.fingerColors ? legend() : ""}`}
    <div class="row-btns" style="margin-top:14px"><button class="btn" id="b-newline">${t("practice.newLine")}</button></div>`;
  };
  W.practice = () => {
    on("b-newline", () => { A.round = null; startRound(); render(); });
    paint();
  };

  /* Lessons */
  V.lessons = () => {
    const st = statuses();
    const usedToday = S().newLessonOn === today();
    const mods = N.CURRICULUM.map((m) => m.module).filter((m) => A.lessons.some((l) => l.module === m));
    return `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:18px">
      <div><h1>${t("tab.lessons")}</h1><p class="muted" style="margin:4px 0 0;max-width:60ch">${t("lessons.intro", { n: N.WINDOW, acc: S().rules.acc })}</p></div>
      <span class="chip ${usedToday || sessionEnded() ? "warn" : "acc"}">${usedToday ? t("lessons.used") : sessionEnded() ? t("plan.lessonLocked") : t("lessons.available")}</span>
    </div>
    ${mods.map((m) => {
      const ls = A.lessons.filter((l) => l.module === m);
      return `<section class="module">
        <div class="mod-head"><h2>${t("module." + m)}</h2><span class="label">${plural("lessons.count", ls.length)}</span></div>
        <div class="lessons">${ls.map((l) => {
          const s = st[A.lessons.indexOf(l)];
          const p = S().lessons[l.id];
          const txt = s === "passed" ? `✓ ${pct(p.bestAcc)}` : t("status." + s);
          return `<a class="lesson ${s === "passed" ? "done" : s === "today" ? "current" : s}" href="#lesson/${l.id}" aria-label="${t("lesson")} ${l.n}" style="color:inherit;text-decoration:none"><span class="ln">L${l.n}</span><span class="st">${txt}</span></a>`;
        }).join("")}</div></section>`;
    }).join("")}`;
  };

  V.lesson = () => {
    const L = lessonById(A.param);
    if (!L) return `<a class="back" href="#lessons">← ${t("lessons.all")}</a>`;
    const s = statusOf(L), p = S().lessons[L.id] || {};
    const mark = new Set(L.kind === "caps" ? L.chars.map((c) => c.toLowerCase()) : L.chars);
    const pool = new Set([...L.pool].filter((c) => L.kind === "mix" || !mark.has(c)));
    const sample = lessonRound(L).text;
    const prev = A.lessons[A.lessons.indexOf(L) - 1];
    const btn = s === "locked" ? `<button class="btn primary" disabled>${t("status.locked")}</button>`
      : s === "tomorrow" ? `<button class="btn primary" disabled>${t("lesson.continuesTomorrow")}</button>`
      : s === "today" ? `<button class="btn primary" id="b-start">${t("lesson.start")}</button>`
      : `<button class="btn primary" id="b-start">${t("lesson.again")}</button>`;
    const chip = s === "passed" ? `<span class="chip good">✓ ${t("status.passed")}</span>`
      : s === "today" ? `<span class="chip acc">${t("lesson.todays")}</span>`
      : s === "tomorrow" ? `<span class="chip warn">${t("lesson.opensTomorrow")}</span>`
      : `<span class="chip">${t("lesson.unlocksAfter", { n: prev ? prev.n : 1 })}</span>`;
    const title = lessonTitle(L);
    const showKb = L.kind !== "words" && L.kind !== "sentences";
    return `<a class="back" href="#lessons">← ${t("lessons.all")}</a>
    <div class="lesson-head" style="margin-top:10px">
      <div><div class="label">${t("module." + L.module)}</div><h1>${t("lesson")} ${L.n}${title ? ` · ${esc(title)}` : ""}</h1></div>${chip}
    </div>
    <div class="detail">
      <div class="grid" style="min-width:0">
        <p style="margin:0;max-width:62ch">${lessonDesc(L)}</p>
        ${showKb ? `<div class="kb-wrap" style="margin:0">${keyboard({ id: "detkb", pool, mark })}</div>
        <div class="kb-legend" style="justify-content:flex-start;margin:0"><span><i class="swatch" style="box-shadow:0 0 0 2px var(--accent);background:var(--surface)"></i>${L.kind === "mix" ? t("legend.mixKeys") : t("legend.newKeys")}</span><span><i class="swatch" style="background:var(--surface);border:1px solid var(--line)"></i>${t("legend.learned")}</span></div>` : ""}
        <div><div class="label" style="margin-bottom:6px">${t("lesson.sample")}</div><div class="sample">${esc(sample)}</div></div>
      </div>
      <aside class="panel" style="display:grid;gap:12px">
        <dl class="kv">
          <div><dt>${t("lesson.target")}</dt><dd>${S().rules.acc}% / ${N.WINDOW}</dd></div>
          <div><dt>${t("lesson.bestAcc")}</dt><dd>${p.bestAcc ? pct(p.bestAcc) : "—"}</dd></div>
          <div><dt>${t("lesson.speed")}</dt><dd>${p.bestWpm ? p.bestWpm + " wpm" : "—"}</dd></div>
          <div><dt>${t("lesson.roundsToPass")}</dt><dd>${p.roundsToPass || "—"}</dd></div>
        </dl>
        ${btn}
      </aside>
    </div>`;
  };
  W.today = () => document.querySelectorAll(".plan a").forEach((a) => a.addEventListener("click", () => { A.drill = { kind: "session" }; }));
  W.lesson = () => on("b-start", () => { A.drill = { kind: "lesson", id: A.param }; A.round = null; go("practice"); });

  function lessonDesc(L) {
    const keys = esc(L.chars.join(" "));
    if (L.kind === "keys") {
      const fingers = [...new Set(L.chars.map((c) => N.keyFor(A.layout, c).finger))].map((f) => t("finger." + f)).join(", ");
      return t("desc.keys", { keys, fingers });
    }
    if (L.kind === "mix") return t("desc.mix", { keys });
    if (L.kind === "words") return t("desc.words", { lang: langName(L.lang) });
    return t("desc." + L.kind, { keys });
  }

  /* Test */
  function testWords() {
    const w = N.words[A.test.lang];
    return w ? w.words.filter((x) => N.canType(A.layout, x)) : [];
  }
  function newTest() {
    stopTestTimer();
    A.test.left = A.test.dur;
    const words = testWords();
    A.round = words.length ? { kind: "test", run: N.createRun(N.wordsText(words, A.test.dur * 15), "test"), shiftWarn: 0 } : null;
  }
  function stopTestTimer() {
    if (A.test.timer) clearInterval(A.test.timer);
    A.test.timer = null;
  }
  V.test = () => {
    const langs = S().settings.practice;
    return `<div class="lesson-head">
      <div><div class="label">${t("test.title")}</div><h1>${esc(langName(A.test.lang))} · ${A.test.dur} s</h1></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${langs.length > 1 ? `<div class="seg-ctl" role="group" aria-label="${t("test.language")}">${langs.map((l) => `<button data-lang="${l}" aria-pressed="${A.test.lang === l}">${l.toUpperCase()}</button>`).join("")}</div>` : ""}
        <div class="seg-ctl" role="group" aria-label="${t("test.duration")}">${TEST_LENGTHS.map((d) => `<button data-dur="${d}" aria-pressed="${A.test.dur === d}">${d} s</button>`).join("")}</div>
      </div></div>
    <div class="meters" style="margin-bottom:10px">
      <div class="meter"><div class="v num" id="t-left">${A.test.left}</div><div class="k">${t("test.seconds")}</div></div>
      <div class="meter"><div class="v num" id="m-wpm">0</div><div class="k">wpm</div></div>
      <div class="meter"><div class="v num" id="m-acc">100%</div><div class="k">${t("accuracy")}</div></div>
    </div>
    ${A.round ? `<div class="strip test-strip blur" id="strip" data-hint="${esc(t("test.startHint"))}"></div>` : `<p class="empty-note">${t("test.noWords")}</p>`}
    <p class="muted" style="font-size:.85rem">${t("test.note")}</p>
    <div class="row-btns"><button class="btn" id="b-retest">${t("test.restart")}</button></div>`;
  };
  W.test = () => {
    document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => { A.test.lang = b.dataset.lang; newTest(); render(); }));
    document.querySelectorAll("[data-dur]").forEach((b) => b.addEventListener("click", () => { A.test.dur = +b.dataset.dur; newTest(); render(); }));
    on("b-retest", () => { newTest(); render(); });
    paint();
  };

  function startTestTimer() {
    A.test.timer = setInterval(() => {
      A.test.left--;
      const el = $("t-left");
      if (el) el.textContent = A.test.left;
      if (A.test.left <= 0) finishTest();
      else paintMeters();
    }, 1000);
  }
  function finishTest() {
    stopTestTimer();
    const R = A.round;
    if (!R || R.kind !== "test") return;
    N.endRun(R.run, performance.now());
    const res = { lang: A.test.lang, dur: A.test.dur, wpm: N.runWpm(R.run, performance.now()), acc: Math.round(N.runAccuracy(R.run) * 10) / 10, errors: R.run.misses };
    const prev = lastTest(res.lang, res.dur);
    day().tests.push({ lang: res.lang, dur: res.dur, wpm: res.wpm, acc: res.acc });
    save();
    overlay(`<div><div class="label">${t("tab.test")} · ${res.lang.toUpperCase()} · ${res.dur} s</div><h2 style="margin-top:6px">${t("test.result")}</h2></div>
      <div class="big-stats"><div><div class="v num">${res.wpm}</div><div class="label">wpm</div></div><div><div class="v num">${pct(res.acc)}</div><div class="label">${t("accuracy")}</div></div><div><div class="v num">${res.errors}</div><div class="label">${t("test.errors")}</div></div></div>
      ${prev ? `<p class="muted" style="margin:0;font-size:.88rem">${t("test.previous", { wpm: prev.wpm, acc: pct(prev.acc) })}</p>` : ""}
      <div class="row-btns"><button class="btn primary" data-a="ok">OK</button></div>`, { ok: () => { newTest(); render(); } });
  }
  function lastTest(lang, dur) {
    for (const k of Object.keys(S().days).sort().reverse()) {
      const ts = S().days[k].tests.filter((x) => x.lang === lang && x.dur === dur);
      if (ts.length) return ts[ts.length - 1];
    }
    return null;
  }

  /* Stats */
  V.stats = () => {
    const totals = N.keyTotals(S().days, today(), 30);
    const rate = (ch) => { const r = totals[ch]; return r && r[0] >= 10 ? (100 * r[1]) / r[0] : null; };
    const lrn = learned();
    const heat = keyboard({ cls: "heat", id: "heat", pool: lrn, label: (code, ch) => {
      if (code === "Space") return `<small>${t("key.space")}</small>`;
      if (ch == null) return `<small>${FIXED[code]}</small>`;
      const v = rate(ch);
      return `${esc(ch)}${v != null ? `<small data-rate="${v}">${fmt(v)}%</small>` : ""}`;
    } });
    const fingers = {};
    for (const ch in totals) {
      const k = N.keyFor(A.layout, ch);
      if (!k || k.finger === "th") continue;
      const f = (fingers[k.finger] ||= [0, 0]);
      f[0] += totals[ch][0]; f[1] += totals[ch][1];
    }
    const frate = (f) => (fingers[f] && fingers[f][0] ? (100 * fingers[f][1]) / fingers[f][0] : null);
    const maxRate = Math.max(5, ...N.FINGERS.map((f) => frate(f) || 0));
    const hasData = Object.keys(totals).length > 0;
    return `<h1 style="margin-bottom:16px">${t("tab.stats")}</h1>
    <section class="panel" style="display:grid;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h2>${t("stats.perKey")}</h2><span class="note">${t("stats.last30")}</span></div>
      <div class="kb-wrap">${heat}</div>
      <div class="kb-legend"><span><i class="swatch" style="background:color-mix(in srgb,var(--good) 35%,var(--surface))"></i>&lt; 2%</span><span><i class="swatch" style="background:color-mix(in srgb,var(--warn) 45%,var(--surface))"></i>2–5%</span><span><i class="swatch" style="background:color-mix(in srgb,var(--bad) 50%,var(--surface))"></i>&gt; 5%</span><span><i class="swatch" style="background:var(--surface);border:1px solid var(--line);opacity:.4"></i>${t("stats.notLearned")}</span></div>
    </section>
    <div class="grid g2" style="margin-top:14px">
      <section class="panel" style="display:grid;gap:12px">
        <h2>${t("stats.perFinger")}</h2>
        ${hasData ? `<div class="bars">${N.FINGERS.map((f) => { const v = frate(f); return `<div class="bar"><span>${t("finger." + f)}</span><span class="t"><b style="width:${v == null ? 0 : Math.min(100, (100 * v) / maxRate)}%;background:var(--f-${f})"></b></span><span class="num" style="text-align:right">${v == null ? "—" : pct(v)}</span></div>`; }).join("")}</div>` : `<p class="empty-note">${t("stats.noData")}</p>`}
      </section>
      <section class="panel chart" style="display:grid;gap:8px">
        <h2>${t("stats.trend")}</h2>
        ${trend()}
        <div class="kb-legend" style="justify-content:flex-start"><span><i class="swatch" style="background:var(--accent)"></i>wpm</span><span><i class="swatch" style="background:var(--good)"></i>${t("accuracy")} %</span></div>
      </section>
    </div>
    <section class="panel" style="margin-top:14px;display:grid;gap:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h2>${t("stats.calendar")}</h2><span class="chip acc">${t("stats.longest", { n: N.longestStreak(S().days) })}</span></div>
      ${calendar(26)}
    </section>`;
  };
  W.stats = () => {
    document.querySelectorAll("#heat small[data-rate]").forEach((s) => {
      const v = +s.dataset.rate, k = s.parentElement;
      k.style.background = `color-mix(in srgb, var(${v < 2 ? "--good" : v < 5 ? "--warn" : "--bad"}) ${v < 2 ? 35 : v < 5 ? 45 : 50}%, var(--surface))`;
    });
  };

  function calendar(weeks) {
    /* Columns are weeks (Mon–Sun), the last column holds today. */
    const now = new Date(), dow = (now.getDay() + 6) % 7;
    const first = N.addDays(today(), -(weeks - 1) * 7 - dow);
    let h = '<div class="cal">';
    for (let i = 0; i < weeks * 7; i++) {
      const k = N.addDays(first, i), d = S().days[k];
      const future = k > today();
      const mins = d ? d.typedMs / 60000 : 0;
      const lv = !d || !N.practised(d) ? 0 : mins < 10 ? 1 : mins < 20 ? 2 : 3;
      h += `<i class="${lv ? "l" + lv : ""} ${k === today() ? "today" : ""}" ${future ? 'style="opacity:.3"' : ""} title="${k}"></i>`;
    }
    return h + "</div>";
  }

  function trend() {
    const keys = Array.from({ length: 14 }, (_, i) => N.addDays(today(), i - 13));
    const pts = keys.map((k) => ({ k, wpm: N.dayWpm(S().days[k]), acc: N.dayAccuracy(S().days[k]) })).filter((p) => p.wpm != null);
    if (!pts.length) return `<p class="empty-note">${t("stats.noData")}</p>`;
    const maxW = Math.max(20, Math.ceil(Math.max(...pts.map((p) => p.wpm)) / 20) * 20); // quarters land on whole numbers
    const minA = Math.min(85, Math.floor(Math.min(...pts.map((p) => p.acc ?? 100)) / 5) * 5);
    const W_ = 420, H = 190, pl = 30, pr = 34, pt = 14, pb = 26;
    const x = (k) => pl + (keys.indexOf(k) * (W_ - pl - pr)) / 13;
    const yW = (v) => pt + (1 - v / maxW) * (H - pt - pb);
    const yA = (v) => pt + (1 - (v - minA) / (100 - minA)) * (H - pt - pb);
    const path = (f, get) => pts.filter((p) => get(p) != null).map((p, i) => (i ? "L" : "M") + x(p.k).toFixed(1) + "," + f(get(p)).toFixed(1)).join("");
    const dateFmt = new Intl.DateTimeFormat(N.lang, { day: "numeric", month: "short" });
    let g = "";
    for (let v = 0; v <= maxW; v += maxW / 4) g += `<line x1="${pl}" x2="${W_ - pr}" y1="${yW(v)}" y2="${yW(v)}" stroke="var(--line)"/><text x="${pl - 6}" y="${yW(v) + 3}" text-anchor="end" font-size="9" fill="var(--muted)">${fmt(v, 0)}</text>`;
    for (let v = minA; v <= 100; v += 5) g += `<text x="${W_ - pr + 6}" y="${yA(v) + 3}" font-size="9" fill="var(--good)">${v}%</text>`;
    g += `<text x="${x(keys[0])}" y="${H - 8}" font-size="9" fill="var(--muted)">${dateFmt.format(N.parseDay(keys[0]))}</text><text x="${x(keys[13])}" y="${H - 8}" font-size="9" text-anchor="end" fill="var(--muted)">${dateFmt.format(N.parseDay(keys[13]))}</text>`;
    const last = pts[pts.length - 1];
    const dots = pts.map((p) => `<circle cx="${x(p.k)}" cy="${yW(p.wpm)}" r="2.5" fill="var(--accent)"/>`).join("");
    return `<svg viewBox="0 0 ${W_} ${H}" role="img" aria-label="${esc(t("stats.trend"))}">${g}<path d="${path(yW, (p) => p.wpm)}" fill="none" stroke="var(--accent)" stroke-width="2.2"/><path d="${path(yA, (p) => p.acc)}" fill="none" stroke="var(--good)" stroke-width="1.6"/>${dots}<text x="${x(last.k) - 6}" y="${yW(last.wpm) - 8}" text-anchor="end" font-size="10" font-weight="700" fill="var(--fg)">${fmt(last.wpm, 0)} wpm</text></svg>`;
  }

  /* Settings */
  const sw = (id, on, label) => `<button class="switch" role="switch" id="${id}" aria-checked="${on}" aria-label="${esc(label)}"></button>`;
  V.settings = () => {
    const R = S().rules, st = S().settings;
    return `<h1>${t("tab.settings")}</h1>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <section class="panel">
        <h2 style="margin-bottom:4px">${t("set.rules")}</h2>
        <div class="set-row"><div><b>${t("set.acc")}</b><div class="muted" style="font-size:.85rem">${t("set.accNote", { n: N.WINDOW })}</div></div><input id="r-acc" type="number" min="90" max="100" value="${R.acc}"></div>
        <div class="set-row"><div><b>${t("set.speed")}</b><div class="muted" style="font-size:.85rem">${t("set.speedNote")}</div></div><input id="r-cap" type="number" min="15" max="150" value="${R.speedCap}"></div>
        <div class="set-row"><div><b>${t("set.shift")}</b><div class="muted" style="font-size:.85rem">${t("set.shiftNote")}</div></div>${sw("r-shift", R.oppositeShift, t("set.shift"))}</div>
        <div class="set-row"><div><b>${t("set.fixed")}</b><div class="muted" style="font-size:.85rem">${t("set.fixedNote")}</div></div><span class="chip">🔒</span></div>
      </section>
      <div class="grid">
        <section class="panel">
          <h2 style="margin-bottom:4px">${t("set.display")}</h2>
          <div class="set-row"><div><b>${t("set.colors")}</b></div>${sw("r-col", R.fingerColors, t("set.colors"))}</div>
          <div class="set-row"><div><b>${t("set.noLook")}</b><div class="muted" style="font-size:.85rem">${t("set.noLookNote")}</div></div>${sw("r-look", R.noLook, t("set.noLook"))}</div>
          <div class="set-row"><div><b>${t("set.keyboardLangs")}</b><div class="muted" style="font-size:.85rem">${esc(A.layout.name)} · ${st.practice.map(langName).map(esc).join(", ")}</div></div><button class="btn" id="b-setup">${t("set.change")}</button></div>
        </section>
        <section class="panel" style="display:grid;gap:10px">
          <h2>${t("set.backup")}</h2>
          <p class="muted" style="margin:0;font-size:.88rem">${t("set.backupNote")}</p>
          <div class="row-btns" style="justify-content:flex-start"><button class="btn" id="b-export">${t("set.export")}</button><label class="btn" for="imp" tabindex="0">${t("set.import")}</label><input id="imp" type="file" accept=".json,application/json" hidden></div>
          <p class="import-msg" id="imp-msg" role="status"></p>
        </section>
      </div>
    </div>`;
  };
  W.settings = () => {
    const num = (id, key, min, max) => $(id).addEventListener("change", (e) => {
      const v = Math.round(+e.target.value);
      S().rules[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : N.DEFAULT_RULES[key];
      e.target.value = S().rules[key];
      save();
    });
    num("r-acc", "acc", 90, 100);
    num("r-cap", "speedCap", 15, 150);
    const tog = (id, key) => on(id, (e) => { S().rules[key] = !S().rules[key]; e.currentTarget.setAttribute("aria-checked", S().rules[key]); save(); });
    tog("r-shift", "oppositeShift"); tog("r-col", "fingerColors"); tog("r-look", "noLook");
    on("b-setup", () => { startSetup(); go("setup"); });
    on("b-export", exportBackup);
    $("imp").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importBackup(f); });
  };

  function exportBackup() {
    const data = N.makeBackup(S(), today());
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `notch-backup-${today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const m = $("imp-msg");
    m.className = "import-msg good";
    m.textContent = t("set.exported", { file: a.download });
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const res = N.readBackup(String(reader.result));
      const m = $("imp-msg");
      if (!res.ok) { m.className = "import-msg bad"; m.textContent = t("import." + res.reason, { file: file.name }); return; }
      overlay(`<h2>${t("import.confirmTitle")}</h2><p class="muted" style="margin:0">${t("import.confirm", { file: esc(file.name) })}</p>
        <div class="row-btns"><button class="btn" data-a="cancel">${t("cancel")}</button><button class="btn primary" data-a="ok">${t("set.import")}</button></div>`, {
        ok: () => { A.state = res.state; save(); location.hash = "today"; location.reload(); },
        cancel: () => {},
      });
    };
    reader.readAsText(file);
  }

  /* ---------- First run ---------- */

  function startSetup() {
    const st = S().settings;
    A.setup = {
      step: 0,
      ui: N.lang,
      practice: st.practice.length ? [...st.practice] : [N.lang],
      layout: st.layout || (N.lang === "hr" ? "hr-qwertz" : "us-qwerty"),
      calib: null,
      msg: "",
    };
  }
  const calibCodes = (iso) => N.CHAR_CODES.filter((c) => iso || c !== "IntlBackslash");
  const calibCode = () => {
    const s = A.setup;
    return A.route === "setup" && s && s.step === 3 && s.calib ? calibCodes(s.calib.iso)[s.calib.i] || null : null;
  };

  V.setup = () => {
    if (!A.setup) startSetup();
    const s = A.setup;
    const steps = [t("setup.ui"), t("setup.practice"), t("setup.keyboard"), t("setup.calibrate")];
    let body = "";
    if (s.step === 0) {
      body = `<h2>${t("setup.uiQ")}</h2><div class="choices">${N.languageIndex.map((l) => `<button class="choice" data-sui="${l.code}" aria-pressed="${s.ui === l.code}"><b>${esc(l.name)}</b><span class="mono">languages/${l.code}/ui.js</span></button>`).join("")}</div>`;
    } else if (s.step === 1) {
      body = `<h2>${t("setup.practiceQ")}</h2><p class="muted" style="margin:0">${t("setup.practiceNote")}</p><div class="choices">${N.languageIndex.map((l) => `<button class="choice" data-slang="${l.code}" aria-pressed="${s.practice.includes(l.code)}"><b>${esc(l.name)}</b><span class="mono">languages/${l.code}/words.js</span></button>`).join("")}</div>`;
    } else if (s.step === 2) {
      body = `<h2>${t("setup.keyboardQ")}</h2><div class="choices">${N.layoutIndex.map((l) => `<button class="choice" data-slay="${l.id}" aria-pressed="${s.layout === l.id}"><b>${esc(l.name)}</b><span class="mono">layouts/${l.id}.js</span></button>`).join("")}
        <button class="choice" data-slay="custom" aria-pressed="${s.layout === "custom"}"><b>${t("setup.calibrateChoice")}</b><span class="mono">${t("setup.calibrateChoiceNote")}</span></button></div>`;
    } else {
      const c = s.calib, codes = calibCodes(c.iso), code = codes[c.i];
      const preview = N.normalizeLayout({ id: "preview", iso: c.iso, base: c.base });
      body = `<h2>${code ? t("setup.pressKey") : t("setup.calibDone")}</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <label style="display:flex;gap:8px;align-items:center;font-size:.9rem">${sw("s-iso", c.iso, "ISO")} ${t("setup.iso")}</label>
        <span class="chip num">${Object.keys(c.base).length} / ${codes.length}</span>
        ${code ? `<span class="calib-now">${t("setup.now")}: <b>${code}</b></span>` : `<span class="chip good">✓ ${t("setup.done")}</span>`}
      </div>
      <div class="kb-wrap">${keyboard({ id: "calkb", layout: preview, showEmpty: true, cls: "fingers" })}</div>
      <div class="row-btns" style="justify-content:flex-start">
        <button class="btn" id="c-skip" ${code ? "" : "disabled"}>${t("setup.skip")}</button>
        <button class="btn" id="c-auto">${t("setup.auto")}</button>
        <button class="btn ghost" id="c-restart">${t("setup.restart")}</button>
      </div>
      <p class="note" id="c-msg">${s.msg || t("setup.deadNote")}</p>`;
    }
    const last = s.step === 3 || (s.step === 2 && s.layout !== "custom");
    const blocked = (s.step === 1 && !s.practice.length) || (s.step === 3 && Object.keys(s.calib.base).length < 10);
    return `<section class="panel" style="display:grid;gap:14px;max-width:780px">
      <div><h1>${t("setup.title")}</h1><p class="muted" style="margin:4px 0 0">${t("setup.intro")}</p></div>
      <div class="steps">${steps.slice(0, s.layout === "custom" ? 4 : 3).map((x, i) => `<span class="${i === s.step ? "on" : i < s.step ? "ok" : ""}">${i + 1}. ${x}</span>`).join("")}</div>
      ${body}
      <div class="row-btns">
        ${S().settings.setupDone ? `<a class="btn" href="#settings">${t("cancel")}</a>` : ""}
        ${s.step > 0 ? `<button class="btn" id="s-back">${t("back")}</button>` : ""}
        <button class="btn primary" id="s-next" ${blocked ? "disabled" : ""}>${last ? t("setup.finish") : t("next")}</button>
      </div>
    </section>`;
  };
  W.setup = () => {
    const s = A.setup;
    document.querySelectorAll("[data-sui]").forEach((b) => b.addEventListener("click", async () => {
      s.ui = b.dataset.sui;
      await loadUI(s.ui);
      N.lang = s.ui;
      render();
    }));
    document.querySelectorAll("[data-slang]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.slang;
      s.practice = s.practice.includes(k) ? s.practice.filter((x) => x !== k) : [...s.practice, k];
      render();
    }));
    document.querySelectorAll("[data-slay]").forEach((b) => b.addEventListener("click", () => { s.layout = b.dataset.slay; render(); }));
    on("s-back", () => { s.step--; s.msg = ""; render(); });
    on("s-next", () => {
      const last = s.step === 3 || (s.step === 2 && s.layout !== "custom");
      if (!last) {
        s.step++;
        if (s.step === 3) s.calib = { iso: true, base: {}, dead: [], i: 0 };
        render();
        return;
      }
      finishSetup();
    });
    on("s-iso", () => { s.calib = { iso: !s.calib.iso, base: {}, dead: [], i: 0 }; s.msg = ""; render(); });
    on("c-restart", () => { s.calib = { iso: s.calib.iso, base: {}, dead: [], i: 0 }; s.msg = ""; render(); });
    on("c-skip", () => { s.calib.i++; s.msg = ""; render(); });
    on("c-auto", readLayoutMap);
    const cur = calibCode();
    if (cur) { const k = keyEl(cur, "calkb"); if (k) k.classList.add("target"); }
  };

  async function readLayoutMap() {
    const s = A.setup;
    try {
      if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) throw new Error("unsupported");
      const map = await navigator.keyboard.getLayoutMap();
      const base = {};
      for (const code of calibCodes(s.calib.iso)) { const v = map.get(code); if (v && v.length === 1) base[code] = v; }
      if (Object.keys(base).length < 10) throw new Error("empty");
      s.calib.base = base;
      s.calib.i = calibCodes(s.calib.iso).length;
      s.msg = t("setup.autoDone");
    } catch (_) {
      s.msg = t("setup.autoUnsupported");
    }
    render();
  }

  function calibrateKey(e) {
    const s = A.setup, code = calibCode();
    if (e.key === "Shift" || e.key === "AltGraph" || e.ctrlKey || e.metaKey || e.altKey || e.getModifierState("AltGraph")) return;
    if (e.code === "Tab" || e.code === "Enter") return;
    e.preventDefault();
    if (e.code !== code) { s.msg = t("setup.wrongKey", { code: e.code || "?" }); render(); return; }
    /* Dead keys and keys that produce nothing are skipped. */
    if (e.key === "Dead") s.calib.dead.push(code);
    else if (e.key.length === 1 && e.key !== " ") s.calib.base[code] = e.getModifierState("CapsLock") ? e.key.toLowerCase() : e.key;
    s.calib.i++;
    s.msg = "";
    render();
  }

  async function finishSetup() {
    const s = A.setup, st = S().settings;
    st.ui = s.ui;
    st.practice = [...s.practice];
    st.layout = s.layout;
    if (s.layout === "custom") S().customLayout = { id: "custom", name: t("setup.myKeyboard"), iso: s.calib.iso, base: { ...s.calib.base }, dead: [...s.calib.dead] };
    try {
      await useSettings();
    } catch (err) {
      console.error(err);
      return;
    }
    st.setupDone = true;
    A.setup = null;
    save();
    go("today");
  }

  /* ---------- Typing ---------- */

  document.addEventListener("keydown", (e) => {
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") { A.heldShift = e.code; }
    if (calibCode()) return calibrateKey(e);
    if (A.overlay) {
      const b = e.key === "Enter" ? A.overlay.querySelector(".btn.primary") : e.key === "Escape" ? A.overlay.querySelector("[data-a=cancel]") || A.overlay.querySelector(".btn.primary") : null;
      if (b) { e.preventDefault(); b.click(); }
      return;
    }
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if ((e.ctrlKey || e.metaKey) && !e.getModifierState("AltGraph")) return;
    if (!A.round || !typingView()) return;
    if (e.key === "Backspace") { e.preventDefault(); typeKey("Backspace"); }
    else if (e.key.length === 1) { e.preventDefault(); typeKey(e.key); }
  });
  document.addEventListener("keyup", (e) => { if (e.code === A.heldShift) A.heldShift = null; });
  window.addEventListener("blur", () => { A.heldShift = null; });

  function typeKey(key) {
    const R = A.round, run = R.run, now = performance.now();
    if (run.endedAt !== null) return;
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    const prevAt = A.lastKeyPerf || now;
    const wasIdle = idle();
    A.lastKeyAt = Date.now();
    if (wasIdle) drawSession();
    A.lastKeyPerf = now;
    if (R.kind === "test" && !A.test.timer) startTestTimer();

    const res = N.press(run, key, now);
    const d = day();
    if (res.type === "hit" || res.type === "miss") {
      if (res.firstTry) N.recordKey(d, res.want, res.type === "hit");
      if (R.windowed && res.firstTry && res.want !== " ") {
        const p = lessonProgress(R.lesson.id);
        p.window = N.pushWindow(p.window, res.type === "hit");
      }
    }
    if (R.kind !== "test") {
      if (res.type === "hit") A.pace.times = [...A.pace.times.slice(1 - N.PACE_CHARS), now];
      if (res.firstTry && res.want !== " ") A.pace.results = (A.pace.results + (res.type === "hit" ? "1" : "0")).slice(-N.PACE_RESULTS);
    }
    if (res.type === "hit") {
      d.advanced++;
      d.typedMs += Math.min(now - prevAt, 2000);
      checkShift(R, res.want);
    }
    if (res.type === "miss" && R.kind !== "test") flashKey(res.want);
    if (res.done) return R.kind === "test" ? finishTest() : roundDone();
    paint();
  }

  function checkShift(R, ch) {
    if (!S().rules.oppositeShift || !A.heldShift) return;
    const k = N.keyFor(A.layout, ch);
    if (!k || k.layer !== "shift") return;
    if (A.heldShift !== N.oppositeShift(A.layout, ch)) R.shiftWarn++;
  }

  function roundDone() {
    const R = A.round, now = performance.now();
    const acc = N.runAccuracy(R.run), wpm = N.runWpm(R.run, now);
    if (R.windowed) {
      const L = R.lesson, p = lessonProgress(L.id);
      p.rounds++;
      p.bestAcc = Math.max(p.bestAcc, Math.round(acc * 10) / 10);
      if (acc >= S().rules.acc) p.bestWpm = Math.max(p.bestWpm, wpm);
      if (statusOf(L) === "today" && N.windowPassed(p.window, S().rules.acc)) {
        p.passedOn = today();
        p.roundsToPass = p.rounds;
        S().newLessonOn = today();
        save();
        return showPass(L, p, wpm);
      }
    }
    save();
    startRound();
    render();
  }

  function showPass(L, p, wpm) {
    const d = day();
    const toWeak = d.session >= PHASES[0].end && d.session < PHASES[1].end; // passed during the lesson phase
    overlay(`<div><div class="label">${t("lesson")} ${L.n}${lessonKeys(L) ? ` · <span class="kn" style="margin:0">${esc(lessonKeys(L))}</span>` : ""}</div>
      <h2 style="margin-top:6px">${t("pass.title")}</h2>
      <p class="muted" style="margin:4px 0 0;font-size:.9rem">${t("pass.note")}</p></div>
      <div class="big-stats"><div><div class="v num" style="color:var(--good)">${pct(N.windowAccuracy(p.window))}</div><div class="label">${t("pass.window", { n: N.WINDOW })}</div></div><div><div class="v num">${wpm}</div><div class="label">wpm</div></div><div><div class="v num">${p.roundsToPass}</div><div class="label">${t("pass.rounds")}</div></div></div>
      <div class="row-btns"><button class="btn primary" data-a="next">${toWeak ? t("pass.nextWeak") : t("continue")}</button></div>`, {
      next: () => {
        if (toWeak) d.session = PHASES[1].end;
        save();
        A.drill = { kind: "session" };
        A.round = null;
        startRound() && render();
      },
    });
  }

  /* ---------- Painting the practice strip ---------- */

  function paintMeters() {
    const R = A.round;
    if (!R) return null;
    const now = performance.now();
    const wpm = N.runWpm(R.run, now), acc = N.runAccuracy(R.run);
    if ($("m-wpm")) $("m-wpm").textContent = wpm;
    if ($("m-acc")) $("m-acc").textContent = pct(acc);
    if (R.windowed && $("w-acc")) {
      const win = lessonProgress(R.lesson.id).window, v = N.windowAccuracy(win);
      $("w-acc").textContent = pct(v);
      $("w-acc").style.color = win.length >= 30 ? (v >= S().rules.acc ? "var(--good)" : "var(--bad)") : "";
      $("w-n").textContent = win.length;
      $("w-bar").style.width = (100 * win.length) / N.WINDOW + "%";
    }
    return wpm;
  }

  function paint() {
    const strip = $("strip"), R = A.round;
    if (!strip || !R) return;
    const run = R.run;
    if (run.startedAt !== null) strip.classList.remove("blur");
    /* Tests are long: show a window around the cursor. */
    let from = 0, to = run.text.length;
    if (R.kind === "test") {
      from = Math.max(0, run.text.lastIndexOf(" ", Math.max(0, run.pos - 40)) + 1);
      to = Math.min(run.text.length, from + 180);
    }
    let h = "";
    for (let i = from; i < to; i++) {
      const c = run.text[i], m = run.marks[i];
      let cls = "c";
      if (i < run.pos) cls += m === "ok" ? " ok" : m === "fixed" ? " fix" : " err";
      if (i === run.pos) cls += run.pending ? " cur err" : " cur";
      h += `<span class="${cls}">${c === " " ? "&nbsp;" : esc(c)}</span>${c === " " ? "<wbr>" : ""}`;
    }
    strip.innerHTML = h;
    const wpm = paintMeters();
    if (R.kind === "test") return;

    document.querySelectorAll("#kb .key.target").forEach((k) => k.classList.remove("target"));
    const want = run.text[run.pos], hint = $("hint");
    if (want == null) return;
    const k = N.keyFor(A.layout, want);
    const mods = [];
    if (k) {
      const el = keyEl(k.code);
      if (el) el.classList.add("target");
      if (k.layer === "shift") { const sh = N.oppositeShift(A.layout, want); mods.push(sh); const s = keyEl(sh); if (s) s.classList.add("target"); }
      if (k.layer === "altgr") { mods.push("AltRight"); const s = keyEl("AltRight"); if (s) s.classList.add("target"); }
    }
    if (hint && k) {
      const modTxt = mods.map((m) => (m === "AltRight" ? "AltGr" : t(m === "ShiftLeft" ? "key.shiftLeft" : "key.shiftRight"))).join(" + ");
      hint.innerHTML = `<span class="label">${t("hint.next")}</span><span class="kn">${want === " " ? t("key.space") : esc(want)}</span>${modTxt ? `<span class="muted">${modTxt} +</span>` : ""}<span class="swatch" style="background:var(--f-${k.finger})"></span>${t("finger." + k.finger)}${run.pending ? ` <span class="chip bad">${t("hint.wrong")}</span>` : ""}`;
    }
    paintPace(wpm);
    if ($("m-shift")) {
      $("m-shift-n").textContent = R.shiftWarn + "×";
      $("m-shift").classList.toggle("warn", R.shiftWarn > 0);
    }
  }

  /* The wpm meter shows recent pace. Over the limit it turns amber; it only
     asks you to slow down when accuracy is slipping too. Nothing moves. */
  function paintPace(roundWpm) {
    const el = $("m-pace"), R = A.round;
    if (!el) return;
    const now = performance.now(), rules = S().rules;
    const recent = N.recentWpm(A.pace.times, now);
    const acc = N.recentAccuracy(A.pace.results);
    const applies = R.lesson && N.speedWarnApplies(R.lesson);
    A.pace.state = applies ? N.paceState({ wpm: recent, acc, cap: rules.speedCap, target: rules.acc, prev: A.pace.state }) : "ok";
    const shown = recent == null ? roundWpm : Math.round(recent);
    $("m-wpm").textContent = shown;
    el.className = "meter pace " + A.pace.state;
    $("m-wpm-k").textContent = A.pace.state === "rushing" ? `wpm · ${t("pace.slow")}` : "wpm";
    el.title = A.pace.state === "rushing" ? t("pace.rushingNote", { wpm: shown, cap: rules.speedCap, acc: pct(acc), target: rules.acc })
      : A.pace.state === "fast" ? t("pace.fastNote", { cap: rules.speedCap }) : "";
  }

  /* ---------- Overlay ---------- */

  function overlay(html, actions) {
    closeOverlay();
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="card" role="dialog" aria-modal="true">${html}</div>`;
    ov.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b) return;
      closeOverlay();
      actions[b.dataset.a] && actions[b.dataset.a]();
    });
    document.body.append(ov);
    A.overlay = ov;
  }
  function closeOverlay() {
    if (A.overlay) A.overlay.remove();
    A.overlay = null;
  }

  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };

  boot();
})(Notch);
