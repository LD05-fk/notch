# Contributing to Notch

Notch is plain HTML, CSS and JavaScript with no build step and no
dependencies, and it has to keep working when `index.html` is opened
straight from disk (`file://`). That rules out `fetch()` of local files and
ES modules, so everything is a classic `<script>` that registers itself on
the global `Notch` object.

```
index.html, style.css     the page
src/                      logic (notch, curriculum, drill, engine, store) and the UI (app.js)
layouts/                  one file per keyboard layout + index.js
languages/<code>/         ui.js (interface strings) and words.js (practice words)
tests/                    node:test tests for the logic
```

Run the tests with `node --test` (or `npm test`). Keep logic in plain
functions in `src/` so it stays testable without a browser.

## Adding a keyboard layout

1. Copy `layouts/us-qwerty.js` to `layouts/<id>.js` (for example
   `de-qwertz.js`).
2. Map each physical key, named by its
   [`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values),
   to the character it types:
   - `base`: the character without modifiers. Every key a lesson uses
     should be here.
   - `shift`: only what isn't simply the upper-case letter (digits and
     punctuation).
   - `altgr`: characters typed with AltGr, if the layout has them.
   - `dead`: keys that are dead keys on this layout (they're left out of
     lessons).
   - `iso: true` if the keyboard has a key between left Shift and Z/Y
     (`IntlBackslash`).
3. Add a line to `layouts/index.js`.
4. Open Notch, choose the layout in Settings → Keyboard and languages, and
   check the on-screen keyboard and the lesson list. Lessons whose keys the
   layout doesn't have are skipped automatically.

Fingers are assigned by physical position, so you never need to set them.
Tip: Chromium's "Read automatically" in calibration
(`navigator.keyboard.getLayoutMap()`) is a quick way to get the base layer.

## Adding a language

A language has two independent parts: the interface (`ui.js`) and the
practice words (`words.js`). You can contribute either or both.

1. Copy `languages/en/` to `languages/<code>/`, using the
   [ISO 639-1](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) code.
2. In `ui.js`, change `registerUI("en", …)` to your code and translate the
   values. Keep the keys and the `{placeholders}`. Plural strings use the
   [CLDR categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
   for your language (`.one`, `.few`, `.other`, …). Missing strings fall
   back to English.
3. In `words.js`, change the code and provide about 1000 common words
   (lower case, one word each, most common first) and 30 or more natural
   sentences. **Write them yourself or use a source whose licence allows
   MIT redistribution**, and say which in the PR.
4. Add a line to `languages/index.js`.

## Pull requests

- All changes go through a pull request and need at least one approving
  review before merging. `main` doesn't accept direct pushes or force pushes.
- CI runs `node --test` on every pull request; it must pass before merging.
- Keep a PR to one thing: one layout, one language, one fix.
- Run `node --test` and open `index.html` once in a browser with the console
  open before submitting.
- No dependencies, no build step, no frameworks. If you think something
  needs one, open an issue first.
