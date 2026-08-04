# RealityCheck repair plan

- Source run: `20260804T225348Z-01facd`
- Target: `http://127.0.0.1:4193/broken`
- Items: **5** · Critical: **0** · Major: **5** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-D296A901BC — Security header does not satisfy the reviewed value policy: content-security-policy

- **MAJOR** · high confidence · rule `security-header-policy-content-security-policy`
- Evidence: [report.html#RC-D296A901BC](report.html#RC-D296A901BC)
- Required scenarios: `baseline`

Configure a reviewed CSP: add the required directives base-uri, form-action, frame-ancestors; remove the forbidden source tokens 'unsafe-eval'. Validate application behavior in staging instead of copying a permissive placeholder.
- Do not weaken the configured rule or add a permissive placeholder only to clear the gate.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-9DFD5F9C8E — Security header does not satisfy the reviewed value policy: permissions-policy

- **MAJOR** · high confidence · rule `security-header-policy-permissions-policy`
- Evidence: [report.html#RC-9DFD5F9C8E](report.html#RC-9DFD5F9C8E)
- Required scenarios: `baseline`

After confirming the route does not need them, set these features to the empty allowlist (): camera, geolocation.
- Do not weaken the configured rule or add a permissive placeholder only to clear the gate.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-A90BB59806 — Security header does not satisfy the reviewed value policy: referrer-policy

- **MAJOR** · high confidence · rule `security-header-policy-referrer-policy`
- Evidence: [report.html#RC-A90BB59806](report.html#RC-A90BB59806)
- Required scenarios: `baseline`

After reviewing outbound navigation, set Referrer-Policy to one of these allowed values: no-referrer, strict-origin-when-cross-origin.
- Do not weaken the configured rule or add a permissive placeholder only to clear the gate.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-749EFF79DA — Security header does not satisfy the reviewed value policy: x-content-type-options

- **MAJOR** · high confidence · rule `security-header-policy-x-content-type-options`
- Evidence: [report.html#RC-749EFF79DA](report.html#RC-749EFF79DA)
- Required scenarios: `baseline`

Set X-Content-Type-Options to exactly nosniff on the final document response.
- Do not weaken the configured rule or add a permissive placeholder only to clear the gate.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-BA5A5DF3FB — A cross-origin executable resource has no integrity proof

- **MAJOR** · high confidence · rule `security-subresource-integrity`
- Evidence: [report.html#RC-BA5A5DF3FB](report.html#RC-BA5A5DF3FB)
- Required scenarios: `baseline`

Pin the reviewed third-party asset, add its cryptographic SRI digest and appropriate crossorigin mode, or self-host the versioned asset; verify behavior before release.
- Never copy a digest from an untrusted response; compute it from the exact reviewed bytes and update it only with an intentional dependency change.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
