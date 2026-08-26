import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NOTE_RULESET_ID, NOTE_RULESET_SOURCE_FILES } from "../realitycheck/scripts/note-ruleset.mjs";

test("note ruleset ID binds the exact deterministic detector and scoring sources", () => {
  const digest = createHash("sha256");
  for (const filename of NOTE_RULESET_SOURCE_FILES) {
    const source = readFileSync(`realitycheck/scripts/${filename}`, "utf8").replaceAll("\r\n", "\n");
    digest.update(`${filename}\0${source}\0`);
  }
  assert.equal(NOTE_RULESET_ID, `sha256:${digest.digest("hex")}`);
});
