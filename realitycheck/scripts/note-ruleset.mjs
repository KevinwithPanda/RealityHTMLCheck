export const NOTE_RULESET_SOURCE_FILES = Object.freeze([
  "note-analyzer.mjs",
  "note-package.mjs",
  "note-summary.mjs",
]);

// SHA-256 of each listed filename + NUL + canonical-LF source + NUL, in order.
// CI recomputes this contract so detector behavior cannot drift silently.
export const NOTE_RULESET_ID = "sha256:d7b0379e32e2acda4293f1b2e591c20c5b6df373fb91bd8c60f808db6522757c";
