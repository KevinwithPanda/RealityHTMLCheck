# RealityCheck repair plan

- Source run: `20260804T163538Z-b0b154`
- Target: `http://127.0.0.1:4182/examples/security-lab/index.html`
- Items: **4** · Critical: **0** · Major: **4** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-D424F2C1C9 — Required security header is missing: content-security-policy

- **MAJOR** · high confidence · rule `security-header-content-security-policy`
- Evidence: [report.html#RC-D424F2C1C9](report.html#RC-D424F2C1C9)
- Required scenarios: `baseline`

Configure the application or trusted edge to emit a reviewed content-security-policy policy on this route.
- Test the actual policy in a staging environment; do not add a permissive placeholder only to satisfy the check.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-DCC68313A4 — Required security header is missing: referrer-policy

- **MAJOR** · high confidence · rule `security-header-referrer-policy`
- Evidence: [report.html#RC-DCC68313A4](report.html#RC-DCC68313A4)
- Required scenarios: `baseline`

Configure the application or trusted edge to emit a reviewed referrer-policy policy on this route.
- Test the actual policy in a staging environment; do not add a permissive placeholder only to satisfy the check.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-3A8DEE4287 — Required security header is missing: x-content-type-options

- **MAJOR** · high confidence · rule `security-header-x-content-type-options`
- Evidence: [report.html#RC-3A8DEE4287](report.html#RC-3A8DEE4287)
- Required scenarios: `baseline`

Configure the application or trusted edge to emit a reviewed x-content-type-options policy on this route.
- Test the actual policy in a staging environment; do not add a permissive placeholder only to satisfy the check.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-50F5B5802D — A sensitive form uses an insecure submission path

- **MAJOR** · high confidence · rule `security-insecure-form`
- Evidence: [report.html#RC-50F5B5802D](report.html#RC-50F5B5802D)
- Required scenarios: `baseline`

Use POST for credentials and submit only to a reviewed HTTPS endpoint.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
