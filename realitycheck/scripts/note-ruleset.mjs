export const NOTE_RULESET_SOURCE_FILES = Object.freeze([
  "note-analyzer.mjs",
  "note-package.mjs",
  "note-summary.mjs",
]);

// SHA-256 of each listed filename + NUL + canonical-LF source + NUL, in order.
// CI recomputes this contract so detector behavior cannot drift silently.
export const NOTE_RULESET_ID = "sha256:e9a854753cbb5ce5d9103475e34e72a0ee7a4712ec42fd727c614830ac55d97d";
