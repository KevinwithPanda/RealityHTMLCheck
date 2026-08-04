# RealityCheck repair plan

- Source run: `20260804T205848Z-25ccf3`
- Target: `http://127.0.0.1:4182/examples/privacy-lab/broken.html`
- Items: **6** · Critical: **0** · Major: **6** · Minor: **0** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-58CF6DE19B — Cookie bytes exceed the project privacy budget

- **MAJOR** · high confidence · rule `privacy-cookie-byte-budget`
- Evidence: [report.html#RC-58CF6DE19B](report.html#RC-58CF6DE19B)
- Required scenarios: `baseline`

Reduce application-owned cookie payloads and avoid storing unnecessary state in cookies; do not delete authentication state without product review.
- RealityCheck intentionally does not retain cookie names, values, storage keys, or storage values.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-F162EB3E74 — Cookie count exceeds the project privacy budget

- **MAJOR** · high confidence · rule `privacy-cookie-count-budget`
- Evidence: [report.html#RC-F162EB3E74](report.html#RC-F162EB3E74)
- Required scenarios: `baseline`

Remove cookies that are not needed for the current product behavior, shorten their lifetime where appropriate, and rerun the audit.
- RealityCheck intentionally does not retain cookie names, values, storage keys, or storage values.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-4813EC95B4 — localStorage bytes exceed the project privacy budget

- **MAJOR** · high confidence · rule `privacy-local-storage-byte-budget`
- Evidence: [report.html#RC-4813EC95B4](report.html#RC-4813EC95B4)
- Required scenarios: `baseline`

Minimize persistent client-side payloads and move only appropriate non-secret data to a reviewed storage design.
- RealityCheck intentionally does not retain cookie names, values, storage keys, or storage values.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-C3D6AFC784 — localStorage entries exceed the project privacy budget

- **MAJOR** · high confidence · rule `privacy-local-storage-entry-budget`
- Evidence: [report.html#RC-C3D6AFC784](report.html#RC-C3D6AFC784)
- Required scenarios: `baseline`

Remove obsolete application-owned localStorage entries with a reviewed migration and retention plan.
- RealityCheck intentionally does not retain cookie names, values, storage keys, or storage values.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-FBF7A4842F — sessionStorage bytes exceed the project privacy budget

- **MAJOR** · high confidence · rule `privacy-session-storage-byte-budget`
- Evidence: [report.html#RC-FBF7A4842F](report.html#RC-FBF7A4842F)
- Required scenarios: `baseline`

Reduce session-only payloads and keep sensitive data out of browser storage unless the design is explicitly reviewed.
- RealityCheck intentionally does not retain cookie names, values, storage keys, or storage values.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-35F26228B0 — sessionStorage entries exceed the project privacy budget

- **MAJOR** · high confidence · rule `privacy-session-storage-entry-budget`
- Evidence: [report.html#RC-35F26228B0](report.html#RC-35F26228B0)
- Required scenarios: `baseline`

Remove obsolete session-only state and consolidate duplicated application-owned entries after reviewing navigation behavior.
- RealityCheck intentionally does not retain cookie names, values, storage keys, or storage values.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
