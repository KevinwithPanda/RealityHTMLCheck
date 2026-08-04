# RealityCheck GitHub issue drafts

Drafts **6** · Actionable **5** · Review **1** · Waived **0** · Duplicates merged **0**

> Drafts are never submitted automatically. Review scope, ownership, confidentiality, labels, and duplicate status before creating external issues.

## [major] Checkout review is outside the mobile viewport

ISSUE-920864929A96 · `realitycheck` `severity:major` `disposition:actionable` `rule:offscreen-critical-control`

## Problem

Checkout review is outside the mobile viewport

- Severity: `major`
- Confidence: `high`
- Rule: `offscreen-critical-control`

## Suggested repair

Remove the fixed minimum shell width and stack the hero actions at the mobile breakpoint.

- Replace min-width: 1040px with responsive grid constraints.
- Allow the primary action to wrap below the heading on narrow screens.

## Acceptance criteria

- Re-run `baseline`, `mobile-375`.
- Stable fingerprint `920864929a9614a5de5d92b964db6d1ed6a07ac7ccbfe092a558884e75ac3170` no longer appears.
- The baseline remains healthy and no regression of equal or greater severity is introduced.

## Evidence

- [reference-demo-v0.4.0 · mobile-375](../reference-run/report.html#RC-920864929A) · http://127.0.0.1:4173/

> This is a locally generated issue draft. Evidence links are relative to the draft bundle; replace them with durable URLs or attach the bundle, then review before creating or assigning a GitHub issue.

---

## [major] Long customer names are clipped without access to the full value

ISSUE-FB7751933E1D · `realitycheck` `severity:major` `disposition:actionable` `rule:element-text-clipping`

## Problem

Long customer names are clipped without access to the full value

- Severity: `major`
- Confidence: `high`
- Rule: `element-text-clipping`

## Suggested repair

Expose the full customer name while preserving the card layout.

- Allow wrapping or add an accessible expansion/tooltip mechanism.

## Acceptance criteria

- Re-run `baseline`, `long-text`.
- Stable fingerprint `fb7751933e1dae1692cc806f39622186159c5007c87abbe0320050ee6c23d572` no longer appears.
- The baseline remains healthy and no regression of equal or greater severity is introduced.

## Evidence

- [reference-demo-v0.4.0 · long-text](../reference-run/report.html#RC-FB7751933E) · http://127.0.0.1:4173/

> This is a locally generated issue draft. Evidence links are relative to the draft bundle; replace them with durable URLs or attach the bundle, then review before creating or assigning a GitHub issue.

---

## [minor] Status alignment remains pinned to the physical right side

ISSUE-02B9DF270A7A · `realitycheck` `severity:minor` `disposition:actionable` `rule:rtl-physical-spacing`

## Problem

Status alignment remains pinned to the physical right side

- Severity: `minor`
- Confidence: `high`
- Rule: `rtl-physical-spacing`

## Suggested repair

Use logical spacing so status alignment follows writing direction.

- Replace margin-left: auto with margin-inline-start: auto.

## Acceptance criteria

- Re-run `baseline`, `rtl-arabic`.
- Stable fingerprint `02b9df270a7ab58db15af335bfcc3292ac41e099604da53ffa54af73bf9baa98` no longer appears.
- The baseline remains healthy and no regression of equal or greater severity is introduced.

## Evidence

- [reference-demo-v0.4.0 · rtl-arabic](../reference-run/report.html#RC-02B9DF270A) · http://127.0.0.1:4173/

> This is a locally generated issue draft. Evidence links are relative to the draft bundle; replace them with durable URLs or attach the bundle, then review before creating or assigning a GitHub issue.

---

## [minor] The page logs an initialization error

ISSUE-7AEAC80E106F · `realitycheck` `severity:minor` `disposition:actionable` `rule:console-error`

## Problem

The page logs an initialization error

- Severity: `minor`
- Confidence: `high`
- Rule: `console-error`

## Suggested repair

Handle optional analytics initialization without emitting a production console error.

- Use a recoverable warning or feature-state result for an optional integration.

## Acceptance criteria

- Re-run `baseline`.
- Stable fingerprint `7aeac80e106f68fc401a23305947ffa0751bfafb0a4020a59cfe79f6d9f08af7` no longer appears.
- The baseline remains healthy and no regression of equal or greater severity is introduced.

## Evidence

- [reference-demo-v0.4.0 · baseline](../reference-run/report.html#RC-7AEAC80E10) · http://127.0.0.1:4173/

> This is a locally generated issue draft. Evidence links are relative to the draft bundle; replace them with durable URLs or attach the bundle, then review before creating or assigning a GitHub issue.

---

## [minor] The customer avatar has no text alternative

ISSUE-831A358F9422 · `realitycheck` `severity:minor` `disposition:actionable` `rule:image-alt`

## Problem

The customer avatar has no text alternative

- Severity: `minor`
- Confidence: `high`
- Rule: `image-alt`

## Suggested repair

Declare the avatar decorative or provide a concise alternative.

- Use alt="" when the adjacent customer name already conveys the same information.

## Acceptance criteria

- Re-run `baseline`, `image-failure`.
- Stable fingerprint `831a358f94229cb373fe4ba69cd7c49f2eb6572d703bfc916c7ff61328a9572e` no longer appears.
- The baseline remains healthy and no regression of equal or greater severity is introduced.

## Evidence

- [reference-demo-v0.4.0 · image-failure](../reference-run/report.html#RC-831A358F94) · http://127.0.0.1:4173/

> This is a locally generated issue draft. Evidence links are relative to the draft bundle; replace them with durable URLs or attach the bundle, then review before creating or assigning a GitHub issue.

---

## [minor] Interactive elements may not expose a visible focus indicator

ISSUE-3E80D0B7409A · `realitycheck` `severity:minor` `disposition:review` `rule:keyboard-focus-visibility`

## Problem

Interactive elements may not expose a visible focus indicator

- Severity: `minor`
- Confidence: `low`
- Rule: `keyboard-focus-visibility`

## Suggested repair

Restore a high-contrast focus-visible style.

- Use :focus-visible with a two-pixel outline and offset.

## Acceptance criteria

- Re-run `baseline`, `keyboard-tab`.
- Stable fingerprint `3e80d0b7409a7389cebefb4da36ff78d5ef5e64d912cd713fb72037acda7d7d9` no longer appears.
- The baseline remains healthy and no regression of equal or greater severity is introduced.

## Evidence

- [reference-demo-v0.4.0 · keyboard-tab](../reference-run/report.html#RC-3E80D0B740) · http://127.0.0.1:4173/

> This is a locally generated issue draft. Evidence links are relative to the draft bundle; replace them with durable URLs or attach the bundle, then review before creating or assigning a GitHub issue.

---

