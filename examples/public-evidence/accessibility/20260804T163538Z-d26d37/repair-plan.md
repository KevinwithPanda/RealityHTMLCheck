# RealityCheck repair plan

- Source run: `20260804T163538Z-d26d37`
- Target: `http://127.0.0.1:4182/examples/accessibility-lab/broken.html`
- Items: **10** · Critical: **1** · Major: **4** · Minor: **5** · Waived: **0** · Review required: **0**

> This is a bounded handoff plan, not proof of a fix. Preserve the source report, change application code only with explicit authorization, and generate new before/after evidence.

## [ ] RC-DD7B086A3B — Buttons must have discernible text

- **CRITICAL** · high confidence · rule `axe-button-name`
- Evidence: [report.html#RC-DD7B086A3B](report.html#RC-DD7B086A3B)
- Required scenarios: `baseline`, `axe`

Buttons must have discernible text
- Fix any of the following:   Element does not have inner text that is visible to screen readers   aria-label attribute does not exist or is empty   aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty   Element has no title attribute   Element does not have an implicit (wrapped) &lt;label&gt;   Element does not have an explicit &lt;label&gt;   Element's default semantics were not overridden with role="none" or role="presentation"
- Rule guidance: https://dequeuniversity.com/rules/axe/4.12/button-name?application=axeAPI

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-6BE52B2D95 — Elements must meet minimum color contrast ratio thresholds

- **MAJOR** · high confidence · rule `axe-color-contrast`
- Evidence: [report.html#RC-6BE52B2D95](report.html#RC-6BE52B2D95)
- Required scenarios: `baseline`, `axe`

Elements must meet minimum color contrast ratio thresholds
- Fix any of the following:   Element has insufficient color contrast of 3.49 (foreground color: #e74f2b, background color: #f4f6f8, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1
- Rule guidance: https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=axeAPI

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-AFEF454665 — Documents must have &lt;title&gt; element to aid in navigation

- **MAJOR** · high confidence · rule `axe-document-title`
- Evidence: [report.html#RC-AFEF454665](report.html#RC-AFEF454665)
- Required scenarios: `baseline`, `axe`

Documents must have &lt;title&gt; element to aid in navigation
- Fix any of the following:   Document does not have a non-empty &lt;title&gt; element
- Rule guidance: https://dequeuniversity.com/rules/axe/4.12/document-title?application=axeAPI

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-26D6D6BE2D — &lt;html&gt; element must have a lang attribute

- **MAJOR** · high confidence · rule `axe-html-has-lang`
- Evidence: [report.html#RC-26D6D6BE2D](report.html#RC-26D6D6BE2D)
- Required scenarios: `baseline`, `axe`

&lt;html&gt; element must have a lang attribute
- Fix any of the following:   The &lt;html&gt; element does not have a lang attribute
- Rule guidance: https://dequeuniversity.com/rules/axe/4.12/html-has-lang?application=axeAPI

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-2467435352 — An interactive control has no accessible name

- **MAJOR** · medium confidence · rule `control-accessible-name`
- Evidence: [report.html#RC-2467435352](report.html#RC-2467435352)
- Required scenarios: `baseline`

Give the control a concise programmatic name using visible text or native labeling first.
- Prefer a native &lt;label&gt;, button text, or alt text before adding ARIA.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-FD6828C986 — Heading levels should only increase by one

- **MINOR** · high confidence · rule `axe-heading-order`
- Evidence: [report.html#RC-FD6828C986](report.html#RC-FD6828C986)
- Required scenarios: `baseline`, `axe`

Heading levels should only increase by one
- Fix any of the following:   Heading order invalid
- Rule guidance: https://dequeuniversity.com/rules/axe/4.12/heading-order?application=axeAPI

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-32F9E9CDA5 — The document does not declare its language

- **MINOR** · high confidence · rule `document-language-missing`
- Evidence: [report.html#RC-32F9E9CDA5](report.html#RC-32F9E9CDA5)
- Required scenarios: `baseline`

Declare the page's primary BCP 47 language tag on the root html element.
- Use a specific tag such as en, zh-CN, or ar and update it when the document language changes.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-D7DABBAD48 — The document has no page title

- **MINOR** · high confidence · rule `document-title-missing`
- Evidence: [report.html#RC-D7DABBAD48](report.html#RC-D7DABBAD48)
- Required scenarios: `baseline`

Add a concise, route-specific title that identifies the page and product.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-BF257020C1 — The document contains duplicate element IDs

- **MINOR** · high confidence · rule `duplicate-element-id`
- Evidence: [report.html#RC-BF257020C1](report.html#RC-BF257020C1)
- Required scenarios: `baseline`

Give every document ID a unique stable value and update all label, fragment, and ARIA references.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.

## [ ] RC-D5EA851B96 — Visible heading levels skip part of the hierarchy

- **MINOR** · medium confidence · rule `heading-level-skip`
- Evidence: [report.html#RC-D5EA851B96](report.html#RC-D5EA851B96)
- Required scenarios: `baseline`

Use heading levels to represent the document outline without skipping an intermediate level.
- Change visual size with CSS rather than choosing a heading level for appearance.

Acceptance: same fingerprint absent; baseline healthy; no same-level regression; every required scenario completed.
