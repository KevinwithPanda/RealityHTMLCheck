import assert from "node:assert/strict";
import test from "node:test";

import { compileHtmlExcludeGlobs, normalizeHtmlExcludeGlob } from "../realitycheck/scripts/note-scope.mjs";

test("portable HTML exclusion globs match whole forward-slash paths deterministically", () => {
  const scope = compileHtmlExcludeGlobs(["archive/**", "**/draft-?.html", "archive/**"]);
  assert.deepEqual(scope.patterns, ["archive/**", "**/draft-?.html"]);
  assert.equal(scope.matches("archive/2024/note.html"), true);
  assert.equal(scope.matches("draft-a.html"), true);
  assert.equal(scope.matches("team/draft-1.html"), true);
  assert.equal(scope.matches("team/draft-long.html"), false);
  assert.equal(scope.matches("Archive/2024/note.html"), false);
  assert.equal(scope.matches("published/archive/note.html"), false);
});

test("HTML exclusion globs reject escapes and platform-specific or ambiguous syntax", () => {
  for (const pattern of [
    "",
    " archive/**",
    "archive/** ",
    "/archive/**",
    "C:/archive/**",
    "../archive/**",
    "archive/../draft.html",
    "archive\\**",
    "archive//*.html",
    "archive/[ab].html",
    "archive/{a,b}.html",
    "archive/!(*.html)",
    "archive/***.html",
    "archive/foo**bar.html",
    "~/archive/**",
    "archive/CON.html",
    "--all.html",
    "archive/line\nbreak.html",
  ]) assert.throws(() => normalizeHtmlExcludeGlob(pattern), /exclude-html|portable|relative|segment|empty|whitespace|dash/);
  assert.throws(() => compileHtmlExcludeGlobs(Array.from({ length: 101 }, (_, index) => `archive-${index}/**`)), /no more than 100/);
});
