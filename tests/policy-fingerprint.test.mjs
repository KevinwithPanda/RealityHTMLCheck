import assert from "node:assert/strict";
import test from "node:test";

import { detectorPolicyFingerprint } from "../realitycheck/scripts/policy-fingerprint.mjs";

test("detector policy fingerprint is order-independent but changes with behavior", () => {
  const first = detectorPolicyFingerprint({
    mode: "quick",
    checks: [
      { id: "second", selector: ".b", assertion: "visible", include: ["/b", "/a"] },
      { id: "first", selector: ".a", assertion: "exists", include: ["/**"] },
    ],
    budgets: { requests: 80, navigationMs: 2000, severity: "major" },
  });
  const reordered = detectorPolicyFingerprint({
    mode: "quick",
    budgets: { severity: "major", navigationMs: 2000, requests: 80 },
    checks: [
      { include: ["/**"], assertion: "exists", selector: ".a", id: "first" },
      { include: ["/a", "/b"], assertion: "visible", selector: ".b", id: "second" },
    ],
  });
  assert.equal(first, reordered);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "deep", checks: [], budgets: null }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 81, severity: "major" } }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], journeys: [{ id: "smoke", startPath: "/", severity: "major", steps: [{ action: "assert", selector: "main", assertion: "exists" }] }], budgets: { requests: 80, navigationMs: 2000, severity: "major" } }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 80, navigationMs: 2000, severity: "major" }, network: { severity: "major", scope: "api", maxHttpErrors: 0 } }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 80, navigationMs: 2000, severity: "major" }, security: { severity: "major", requiredHeaders: ["content-security-policy"] } }));
});
