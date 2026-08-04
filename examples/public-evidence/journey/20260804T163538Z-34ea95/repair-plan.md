# RealityCheck repair plan

- Source run: `20260804T163538Z-34ea95`
- Target: `http://127.0.0.1:4182/examples/journey-lab/broken.html`
- Items: **1** · Critical: **0** · Major: **1** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-0F3087966F — User journey failed: Settings notifications remain usable

- **MAJOR** · high confidence · rule `journey-settings-notifications`
- Evidence: [report.html#RC-0F3087966F](report.html#RC-0F3087966F)
- Required scenarios: `baseline`, `journey-settings-notifications`

Restore the first failed application state or transition; keep the journey assertion unchanged and rerun the entire journey.
- Use the step trace and failure screenshot to distinguish a missing state from a blocked transition.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
