# RealityCheck repair plan

- Source run: `20260804T183414Z-db76fb`
- Target: `http://127.0.0.1:4183/index.html`
- Items: **1** · Critical: **0** · Major: **1** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-F9DFD0AFA5 — Current rendering differs from the approved visual baseline

- **MAJOR** · high confidence · rule `visual-regression-threshold`
- Evidence: [report.html#RC-F9DFD0AFA5](report.html#RC-F9DFD0AFA5)
- Required scenarios: `baseline`

Repair the unintended application-owned rendering change and rerun the audit. If the change is intentional, review it and explicitly replace the baseline with visual-approve --replace-baseline.
- Do not raise the threshold or overwrite the baseline solely to clear the gate.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
