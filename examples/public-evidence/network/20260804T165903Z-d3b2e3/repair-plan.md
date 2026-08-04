# RealityCheck repair plan

- Source run: `20260804T165903Z-d3b2e3`
- Target: `http://127.0.0.1:4182/examples/network-lab/broken.html`
- Items: **1** · Critical: **0** · Major: **1** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-55552DF828 — HTTP error responses exceed the network reliability budget

- **MAJOR** · high confidence · rule `network-http-error-budget`
- Evidence: [report.html#RC-55552DF828](report.html#RC-55552DF828)
- Required scenarios: `baseline`

Restore each application-owned endpoint or remove the request intentionally; document an exception instead of hiding a known failure.
- Start with 5xx responses and XHR/fetch calls on the critical path.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
