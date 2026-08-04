# RealityCheck repair plan

- Source run: `20260804T180133Z-00ac02`
- Target: `http://127.0.0.1:4182/examples/metadata-lab/broken.html`
- Items: **7** · Critical: **0** · Major: **6** · Minor: **1** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-51D4CB4D14 — Canonical link is missing, duplicated, or invalid

- **MAJOR** · high confidence · rule `metadata-canonical`
- Evidence: [report.html#RC-51D4CB4D14](report.html#RC-51D4CB4D14)
- Required scenarios: `baseline`

Emit exactly one reviewed absolute canonical URL for this document.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-FC9B00B542 — Meta description does not meet the publishing policy

- **MAJOR** · high confidence · rule `metadata-description-length`
- Evidence: [report.html#RC-FC9B00B542](report.html#RC-FC9B00B542)
- Required scenarios: `baseline`

Add one accurate, page-specific meta description within the configured range; do not stuff keywords.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-DE543A763E — Page does not expose exactly one primary heading

- **MAJOR** · high confidence · rule `metadata-h1-count`
- Evidence: [report.html#RC-DE543A763E](report.html#RC-DE543A763E)
- Required scenarios: `baseline`

Keep one page-specific h1 and demote or consolidate competing top-level headings without hiding content.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-BF5823BDC5 — Page is marked noindex against publishing policy

- **MAJOR** · high confidence · rule `metadata-robots-noindex`
- Evidence: [report.html#RC-BF5823BDC5](report.html#RC-BF5823BDC5)
- Required scenarios: `baseline`

Remove noindex only after confirming this route is intended for public indexing and no equivalent header blocks it.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-4CA707B13D — Document title does not meet the publishing policy

- **MAJOR** · high confidence · rule `metadata-title-length`
- Evidence: [report.html#RC-4CA707B13D](report.html#RC-4CA707B13D)
- Required scenarios: `baseline`

Provide one concise, page-specific title within the configured length range.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-12B8E2C4B7 — Responsive viewport metadata is missing or ambiguous

- **MAJOR** · high confidence · rule `metadata-viewport`
- Evidence: [report.html#RC-12B8E2C4B7](report.html#RC-12B8E2C4B7)
- Required scenarios: `baseline`

Provide one reviewed viewport declaration that includes width=device-width.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-1121CA3B1F — The document does not declare its language

- **MINOR** · high confidence · rule `document-language-missing`
- Evidence: [report.html#RC-1121CA3B1F](report.html#RC-1121CA3B1F)
- Required scenarios: `baseline`

Declare the page's primary BCP 47 language tag on the root html element.
- Use a specific tag such as en, zh-CN, or ar and update it when the document language changes.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
