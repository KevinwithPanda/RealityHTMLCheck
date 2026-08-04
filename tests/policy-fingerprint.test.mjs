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
  assert.notEqual(detectorPolicyFingerprint({ mode: "quick", viewports: [{ id: "mobile-375", width: 375, height: 812, touch: true }] }), detectorPolicyFingerprint({ mode: "quick", viewports: [{ id: "phone-320", width: 320, height: 700, touch: true }] }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 81, severity: "major" } }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], journeys: [{ id: "smoke", startPath: "/", severity: "major", steps: [{ action: "assert", selector: "main", assertion: "exists" }] }], budgets: { requests: 80, navigationMs: 2000, severity: "major" } }));
  const arrowJourney = { mode: "quick", journeys: [{ id: "tabs", startPath: "/", severity: "major", steps: [{ action: "press", selector: "[role=tab]", key: "ArrowRight" }, { action: "assert-url", path: "/settings" }] }] };
  assert.notEqual(detectorPolicyFingerprint(arrowJourney), detectorPolicyFingerprint({ ...arrowJourney, journeys: [{ ...arrowJourney.journeys[0], steps: [{ action: "press", selector: "[role=tab]", key: "ArrowLeft" }, { action: "assert-url", path: "/settings" }] }] }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 80, navigationMs: 2000, severity: "major" }, network: { severity: "major", scope: "api", maxHttpErrors: 0 } }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 80, navigationMs: 2000, severity: "major" }, links: { severity: "major", maxFailures: 0, maxChecked: 50, timeoutMs: 5000 } }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 80, navigationMs: 2000, severity: "major" }, metadata: { severity: "major", requireCanonical: true } }));
  const visual = { severity: "major", baselineDirectory: "baselines", baselineDirectoryPath: "/machine/a/baselines", maxDiffRatio: 0.01, pixelThreshold: 32, masks: [".clock"] };
  const visualFingerprint = detectorPolicyFingerprint({ mode: "quick", visual });
  assert.notEqual(first, visualFingerprint);
  assert.equal(visualFingerprint, detectorPolicyFingerprint({ mode: "quick", visual: { ...visual, baselineDirectoryPath: "/different/machine/baselines" } }));
  assert.notEqual(first, detectorPolicyFingerprint({ mode: "quick", checks: [], budgets: { requests: 80, navigationMs: 2000, severity: "major" }, security: { severity: "major", requiredHeaders: ["content-security-policy"] } }));
});
