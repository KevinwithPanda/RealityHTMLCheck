# RealityCheck repair plan

Source run: `reference-demo-v0.4.0`
Target: `http://127.0.0.1:4173/`  
Items: **6** · Critical: **0** · Major: **2** · Minor: **4** · Waived: **0** · Review required: **1**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-FB7751933E — Long customer names are clipped without access to the full value

**MAJOR** · high confidence · rule `element-text-clipping`  
Evidence: [report.html#RC-FB7751933E](report.html#RC-FB7751933E)  
Required scenarios: `baseline`, `long-text`

Expose the full customer name while preserving the card layout.
- Allow wrapping or add an accessible expansion/tooltip mechanism.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-920864929A — Checkout review is outside the mobile viewport

**MAJOR** · high confidence · rule `offscreen-critical-control`  
Evidence: [report.html#RC-920864929A](report.html#RC-920864929A)  
Required scenarios: `baseline`, `mobile-375`

Remove the fixed minimum shell width and stack the hero actions at the mobile breakpoint.
- Replace min-width: 1040px with responsive grid constraints.
- Allow the primary action to wrap below the heading on narrow screens.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-7AEAC80E10 — The page logs an initialization error

**MINOR** · high confidence · rule `console-error`  
Evidence: [report.html#RC-7AEAC80E10](report.html#RC-7AEAC80E10)  
Required scenarios: `baseline`

Handle optional analytics initialization without emitting a production console error.
- Use a recoverable warning or feature-state result for an optional integration.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-831A358F94 — The customer avatar has no text alternative

**MINOR** · high confidence · rule `image-alt`  
Evidence: [report.html#RC-831A358F94](report.html#RC-831A358F94)  
Required scenarios: `baseline`, `image-failure`

Declare the avatar decorative or provide a concise alternative.
- Use alt="" when the adjacent customer name already conveys the same information.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-02B9DF270A — Status alignment remains pinned to the physical right side

**MINOR** · high confidence · rule `rtl-physical-spacing`  
Evidence: [report.html#RC-02B9DF270A](report.html#RC-02B9DF270A)  
Required scenarios: `baseline`, `rtl-arabic`

Use logical spacing so status alignment follows writing direction.
- Replace margin-left: auto with margin-inline-start: auto.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-3E80D0B740 — Interactive elements may not expose a visible focus indicator

**MINOR** · low confidence · rule `keyboard-focus-visibility`  
Evidence: [report.html#RC-3E80D0B740](report.html#RC-3E80D0B740)  
Required scenarios: `baseline`, `keyboard-tab`

Restore a high-contrast focus-visible style.
- Use :focus-visible with a two-pixel outline and offset.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
