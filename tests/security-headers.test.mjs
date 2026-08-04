import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSecurityHeaderPolicies, requiredSecurityHeaders } from "../realitycheck/scripts/security-headers.mjs";

const policy = {
  requiredHeaders: ["permissions-policy"],
  headerPolicies: {
    contentSecurityPolicy: { requiredDirectives: ["default-src", "base-uri", "form-action"], forbiddenTokens: ["'unsafe-eval'", "*"] },
    strictTransportSecurity: { minMaxAgeSeconds: 31536000, requireIncludeSubDomains: true, requirePreload: true },
    xContentTypeOptions: { requireNosniff: true },
    referrerPolicy: { allowedValues: ["no-referrer", "strict-origin-when-cross-origin"] },
    permissionsPolicy: { disabledFeatures: ["camera", "microphone", "geolocation"] },
  },
};

test("semantic security header policies expose bounded facts without retaining raw values", () => {
  const headers = {
    "content-security-policy": "default-src https://private.example/token-value; script-src * 'unsafe-eval'",
    "strict-transport-security": "max-age=300; includeSubDomains",
    "x-content-type-options": "sniff",
    "referrer-policy": "unsafe-url",
    "permissions-policy": "camera=(self \"https://private.example\"), microphone=()",
  };
  const checks = evaluateSecurityHeaderPolicies(headers, policy, { documentUrl: "https://app.example/" });
  assert.deepEqual(requiredSecurityHeaders(policy), ["content-security-policy", "permissions-policy", "referrer-policy", "strict-transport-security", "x-content-type-options"]);
  assert.equal(checks.length, 5);
  const csp = checks.find((item) => item.key === "contentSecurityPolicy");
  assert.deepEqual(csp.violations, ["missing-required-directive", "forbidden-source-token"]);
  assert.deepEqual(csp.facts.missingDirectives, ["base-uri", "form-action"]);
  assert.deepEqual(csp.facts.forbiddenTokens, ["'unsafe-eval'", "*"]);
  const hsts = checks.find((item) => item.key === "strictTransportSecurity");
  assert.deepEqual(hsts.facts, { maxAgeSeconds: 300, includeSubDomains: true, preload: false, documentHttps: true });
  assert.deepEqual(hsts.violations, ["max-age-too-short", "preload-missing"]);
  assert.deepEqual(checks.find((item) => item.key === "xContentTypeOptions").violations, ["nosniff-required"]);
  assert.deepEqual(checks.find((item) => item.key === "referrerPolicy").violations, ["referrer-policy-not-allowed"]);
  const permissions = checks.find((item) => item.key === "permissionsPolicy");
  assert.deepEqual(permissions.violations, ["feature-not-disabled"]);
  assert.deepEqual(permissions.facts, { declaredFeatures: ["camera", "microphone"], disabledFeatures: ["microphone"], missingDisabledFeatures: ["camera", "geolocation"] });
  assert.doesNotMatch(JSON.stringify(checks), /private\.example|token-value|default-src https/);
});

test("semantic security header policies pass reviewed values and fail closed on missing headers", () => {
  const passing = evaluateSecurityHeaderPolicies({
    "content-security-policy": "default-src 'self'; base-uri 'none'; form-action 'self'; script-src 'self'",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "referrer-policy": "origin, strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  }, policy, { documentUrl: "https://app.example/" });
  assert.equal(passing.every((item) => item.passed), true, passing);
  const missing = evaluateSecurityHeaderPolicies({}, policy);
  assert.equal(missing.every((item) => !item.present && item.violations[0] === "missing-header"), true);
  const http = evaluateSecurityHeaderPolicies({ "strict-transport-security": "max-age=63072000; includeSubDomains; preload" }, { headerPolicies: { strictTransportSecurity: policy.headerPolicies.strictTransportSecurity } }, { documentUrl: "http://app.example/" });
  assert.deepEqual(http[0].violations, ["https-required"]);
});
