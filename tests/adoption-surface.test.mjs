import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("community HTML export intake is versioned, privacy-safe, and evidence-bounded", () => {
  const template = readFileSync(".github/ISSUE_TEMPLATE/html-note-export.yml", "utf8");
  assert.match(template, /Exporting tool and version/);
  assert.match(template, /Platform where the export was created/);
  assert.match(template, /Public sanitized fixture or reproduction link/);
  assert.match(template, /removed personal, confidential, credential, account, and proprietary content/);
  assert.match(template, /not official or universal vendor compatibility/);
  assert.match(template, /MIT-licensed regression evidence/);
});
