/* Loads Notch's classic scripts into Node the same way the browser does. */
const path = require("node:path");
const root = path.join(__dirname, "..");
for (const f of ["src/notch.js", "src/curriculum.js", "src/drill.js", "src/engine.js", "src/store.js", "layouts/hr-qwertz.js", "layouts/us-qwerty.js"])
  require(path.join(root, f));

/* Deterministic random numbers (mulberry32), so failures reproduce. */
function seeded(seed = 1) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { N: globalThis.Notch, seeded };
