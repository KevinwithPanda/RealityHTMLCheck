# RealityCheck repair plan

- Source run: `20260804T192344Z-7e2cb7`
- Target: `http://127.0.0.1:4182/examples/viewport-lab/broken.html`
- Items: **1** · Critical: **0** · Major: **1** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-C735CB3F02 — Review release is outside the phone-320 viewport

- **MAJOR** · high confidence · rule `offscreen-critical-control`
- Evidence: [report.html#RC-C735CB3F02](report.html#RC-C735CB3F02)
- Required scenarios: `baseline`, `phone-320`

Keep the control in normal responsive flow at this breakpoint.
- Remove fixed minimum widths and stack actions below headings when space is constrained.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
