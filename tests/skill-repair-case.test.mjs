import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the recorded Skill repair case proves a separate 56-to-100 working copy", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-skill-repair-case.mjs"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /56\/100 → 100\/100/);
  assert.match(result.stdout, /0 regressions/);

  const contract = JSON.parse(readFileSync("examples/skill-repair-case/case.json", "utf8"));
  assert.equal(contract.sourceModified, false);
  assert.deepEqual(contract.expected, {
    beforeHasErrors: true,
    beforeScore: 56,
    beforeErrors: 3,
    beforeWarnings: 18,
    afterErrors: 0,
    afterWarnings: 0,
    afterScore: 100,
    newRegressions: 0,
  });
  assert.ok(contract.changes.length >= 7);

  const publicCase = readFileSync("examples/skill-repair-case/index.html", "utf8");
  assert.match(publicCase, /source modified\s+NO/);
  assert.match(publicCase, /56 \/ 100/);
  assert.match(publicCase, /100 \/ 100/);
  assert.match(publicCase, /Ambiguous missing content must remain unresolved/);
  assert.match(publicCase, /not that Codex generated these exact edits or will choose identical edits/);
});
