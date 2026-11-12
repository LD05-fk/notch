/* Typing runs and the pass rule. No DOM; time is passed in so it's testable.

   Lesson mode: a wrong key doesn't advance, the right key must follow;
   accuracy counts first-try hits; Backspace does nothing.
   Test mode: every key advances, Backspace goes back, mistakes don't block. */
(function (N) {
  N.WINDOW = 300;

  N.createRun = (text, mode) => ({
    text, mode, pos: 0,
    marks: new Array(text.length).fill(""), // "" | ok | fixed | err
    pending: false, hits: 0, misses: 0, startedAt: null, endedAt: null,
  });

  /* Returns what happened: { type: "hit"|"miss"|"back"|"none", want, firstTry, done } */
  N.press = function (run, key, now) {
    if (run.endedAt !== null) return { type: "none" };
    if (run.startedAt === null) run.startedAt = now;
    const want = run.text[run.pos];

    if (key === "Backspace") {
      if (run.mode !== "test" || run.pos === 0) return { type: "none" };
      run.pos--;
      run.marks[run.pos] = "";
      return { type: "back" };
    }

    if (run.mode === "test") {
      const ok = key === want;
      run.marks[run.pos] = ok ? "ok" : "err";
      ok ? run.hits++ : run.misses++;
      run.pos++;
      return finishIfDone(run, now, { type: ok ? "hit" : "miss", want, firstTry: true });
    }

    if (key !== want) {
      const firstTry = !run.pending;
      if (firstTry) run.misses++;
      run.pending = true;
      run.marks[run.pos] = "err";
      return { type: "miss", want, firstTry };
    }
    const firstTry = !run.pending;
    if (firstTry) run.hits++;
    run.marks[run.pos] = firstTry ? "ok" : "fixed";
    run.pending = false;
    run.pos++;
    return finishIfDone(run, now, { type: "hit", want, firstTry });
  };

  function finishIfDone(run, now, result) {
    if (run.pos >= run.text.length) run.endedAt = now;
    return { ...result, done: run.endedAt !== null };
  }

  N.endRun = (run, now) => {
    if (run.endedAt === null) run.endedAt = now;
  };

  /* Words per minute: correct characters / 5 per minute since the first key. */
  N.runWpm = function (run, now) {
    if (run.startedAt === null) return 0;
    const sec = ((run.endedAt ?? now) - run.startedAt) / 1000;
    if (sec < 1) return 0;
    const correct = run.mode === "test" ? run.marks.filter((m) => m === "ok").length : run.pos;
    return Math.round(correct / 5 / (sec / 60));
  };

  N.runAccuracy = (run) => (run.hits + run.misses ? (100 * run.hits) / (run.hits + run.misses) : 100);

  /* ---------- Pace: is speed costing accuracy right now? ----------
     Judged on recent typing, not the round average, so it reacts to what you're
     doing now and calms down as soon as you do. */
  N.PACE_CHARS = 20; // recent speed: the last 20 characters typed
  N.PACE_RESULTS = 50; // recent accuracy: the last 50 first tries
  N.PACE_MARGIN = 3; // once flagged, stays until pace drops 3 wpm under the limit

  /* times: when each character was typed (ms). Pausing lowers the result,
     because the span runs up to `now`. */
  N.recentWpm = function (times, now, n = N.PACE_CHARS) {
    if (times.length < n) return null;
    const sec = (now - times[times.length - n]) / 1000;
    return sec > 0 ? n / 5 / (sec / 60) : null;
  };

  /* results: first-try outcomes as a 1/0 string, like the pass window. */
  N.recentAccuracy = (results, n = N.PACE_RESULTS) => N.windowAccuracy(results.slice(-n));

  /* "ok": at or under the limit. "fast": over it but accuracy holds (a quiet
     hint). "rushing": over it and accuracy is under the target (slow down). */
  N.paceState = function ({ wpm, acc, cap, target, prev = "ok" }) {
    if (wpm == null) return "ok";
    const limit = prev === "ok" ? cap : cap - N.PACE_MARGIN;
    if (wpm <= limit) return "ok";
    return acc < target ? "rushing" : "fast";
  };

  /* The pass window: first-try results of the last 300 non-space characters,
     kept as a string of 1/0 so it can be stored as-is. */
  N.pushWindow = (win, ok) => (win + (ok ? "1" : "0")).slice(-N.WINDOW);
  N.windowAccuracy = (win) => (win.length ? (100 * [...win].filter((c) => c === "1").length) / win.length : 100);
  N.windowPassed = (win, target) => win.length >= N.WINDOW && N.windowAccuracy(win) >= target;
})(Notch);
