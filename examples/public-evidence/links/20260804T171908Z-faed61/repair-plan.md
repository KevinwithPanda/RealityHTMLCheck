# RealityCheck repair plan

- Source run: `20260804T171908Z-faed61`
- Target: `http://127.0.0.1:4182/examples/link-lab/broken.html`
- Items: **1** · Critical: **0** · Major: **1** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-D9B4C0700C — Broken same-origin links exceed the project budget

- **MAJOR** · high confidence · rule `link-integrity-failure-budget`
- Evidence: [report.html#RC-D9B4C0700C](report.html#RC-D9B4C0700C)
- Required scenarios: `baseline`

Correct or remove every sampled broken href, preserve intentional redirects, and rerun the same link policy without increasing its failure allowance.
- HEAD 405/501 responses are recorded as unsupported rather than broken; verify those endpoints manually or make their HEAD behavior standards-compatible.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
