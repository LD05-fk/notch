/* Copy to config.local.js (gitignored) to preset Notch and skip first run.
   Everything is optional. These are starting values only: once you change
   something in Settings, what you chose there wins. */
Notch.config = {
  layout: "us-qwerty",      // an id from layouts/index.js
  ui: "en",                 // interface language, a code from languages/index.js
  practice: ["en"],         // practice languages for tests and real words
  skipSetup: true,          // don't show first run
  // rules: { acc: 97, speedCap: 45, oppositeShift: true, fingerColors: true, noLook: false },
};
