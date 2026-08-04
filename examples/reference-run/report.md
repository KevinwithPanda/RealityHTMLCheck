# RealityCheck report

- **Score:** 78/100
- **Target:** `http://127.0.0.1:4173/`
- **Mode:** quick
- **Adapter:** project-playwright (fresh-context)
- **Run:** `reference-demo-v0.4.0`
- **Threshold:** major - FAILED

> Automated checks cover only the recorded scenarios and cannot prove the absence of bugs or complete WCAG compliance.

## Release gate reasons

- 2 active finding(s) met the configured severity threshold; expected 0.

## Summary

| Critical | Major | Minor | Info | Baseline penalty | Chaos penalty |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 2 | 4 | 0 | 3.0 | 19.0 |

## Scenarios

| Scenario | Status | Duration | Notes |
| --- | --- | ---: | --- |
| `baseline` | completed-with-findings | 4100 ms | One intentional console error was observed. |
| `mobile-375` | completed-with-findings | 6200 ms | - |
| `long-text` | completed-with-findings | 6700 ms | 12 deterministic text mutations were applied. |
| `rtl-arabic` | completed-with-findings | 5900 ms | Directionality stress test only; translation quality was not assessed. |
| `image-failure` | completed-with-findings | 5500 ms | Expected image request aborts were excluded from failed-request findings. |
| `keyboard-tab` | completed-with-findings | 7100 ms | No controls were activated or submitted. |

## Findings

### Long customer names are clipped without access to the full value

`RC-FB7751933E` | **MAJOR** | high confidence | new | `long-text`

The customer name exceeds its fixed width and is hidden with ellipsis after deterministic long-text injection.

- Rule: `element-text-clipping`
- URL: `http://127.0.0.1:4173/`
- Element: `[data-testid=customer-name]`

Measurements:

    {
      "clientWidth": 185,
      "clippedPixels": 247,
      "scrollWidth": 432
    }

Evidence:

- **dom:** {"selector": "[data-testid=customer-name]", "text": "超长客户名称：上海现实检查与可靠性工程联合实验室"}

Reproduce:

1. Run the long-text scenario with seed 42.
2. Inspect the priority customer name in the Review required panel.

Recommended fix:

Expose the full customer name while preserving the card layout.
- Allow wrapping or add an accessible expansion/tooltip mechanism.

---

### Checkout review is outside the mobile viewport

`RC-920864929A` | **MAJOR** | high confidence | new | `mobile-375`

The fixed 1040px application shell places the primary checkout action beyond the 375px viewport.

- Rule: `offscreen-critical-control`
- URL: `http://127.0.0.1:4173/`
- Element: `[data-testid=checkout]`

Measurements:

    {
      "documentScrollWidth": 1040,
      "overflowPixels": 665,
      "viewportWidth": 375
    }

Evidence:

- **dom:** {"boundingBox": {"height": 42, "width": 166, "x": 842, "y": 116}, "selector": "[data-testid=checkout]"}

Reproduce:

1. Open the demo at a 375x812 viewport.
2. Observe that the Start checkout review button is outside the initial viewport.

Recommended fix:

Remove the fixed minimum shell width and stack the hero actions at the mobile breakpoint.
- Replace min-width: 1040px with responsive grid constraints.
- Allow the primary action to wrap below the heading on narrow screens.

---

### The page logs an initialization error

`RC-7AEAC80E10` | **MINOR** | high confidence | existing | `baseline`

A console error is emitted during the baseline load before any stress scenario runs.

- Rule: `console-error`
- URL: `http://127.0.0.1:4173/`

Measurements:

    {
      "occurrences": 1
    }

Evidence:

- **console:** {"level": "error", "text": "RealityCheck demo: simulated analytics initialization failure"}

Reproduce:

1. Open the demo in a clean desktop browser context.
2. Observe the first console error emitted after navigation.

Recommended fix:

Handle optional analytics initialization without emitting a production console error.
- Use a recoverable warning or feature-state result for an optional integration.

---

### The customer avatar has no text alternative

`RC-831A358F94` | **MINOR** | high confidence | existing | `image-failure`

When the image fails, no alternative text identifies whether the image is decorative or meaningful.

- Rule: `image-alt`
- URL: `http://127.0.0.1:4173/`
- Element: `.customer img`

Measurements:

    {
      "altPresent": false,
      "renderedHeight": 56,
      "renderedWidth": 56
    }

Evidence:

- **dom:** {"outerHtml": "&lt;img src=\"avatar.svg\" width=\"56\" height=\"56\"&gt;", "selector": ".customer img"}

Reproduce:

1. Open the demo and inspect the priority customer avatar.
2. Abort image requests and confirm that no alt text is available.

Recommended fix:

Declare the avatar decorative or provide a concise alternative.
- Use alt="" when the adjacent customer name already conveys the same information.

---

### Status alignment remains pinned to the physical right side

`RC-02B9DF270A` | **MINOR** | high confidence | new | `rtl-arabic`

The status chip uses margin-left instead of a logical property and does not mirror with document direction.

- Rule: `rtl-physical-spacing`
- URL: `http://127.0.0.1:4173/`
- Element: `.status`

Measurements:

    {
      "direction": "rtl",
      "marginInlineStart": "0px",
      "marginLeft": "auto"
    }

Evidence:

- **dom:** {"computedStyle": {"margin-left": "auto", "margin-right": "0px"}, "selector": ".status"}

Reproduce:

1. Set html dir=rtl and lang=ar in a fresh context.
2. Inspect the alignment of status chips in panel headers.

Recommended fix:

Use logical spacing so status alignment follows writing direction.
- Replace margin-left: auto with margin-inline-start: auto.

---

### Interactive elements may not expose a visible focus indicator

`RC-3E80D0B740` | **MINOR** | low confidence | existing | `keyboard-tab`

Computed focus styles remove both outline and box shadow, but pixel-difference evidence was not captured in this reference fixture.

- Rule: `keyboard-focus-visibility`
- URL: `http://127.0.0.1:4173/`
- Element: `button.primary`

Measurements:

    {
      "boxShadow": "none",
      "outlineStyle": "none"
    }

Evidence:

- **focus-sequence:** {"entries": [{"boxShadow": "none", "outlineStyle": "none", "selector": "button.primary"}]}

Reproduce:

1. Navigate to the demo using only Tab.
2. Observe focus on the Start checkout review button.

Recommended fix:

Restore a high-contrast focus-visible style.
- Use :focus-visible with a two-pixel outline and offset.

---

## Coverage warnings

- This committed reference run exercises the deterministic renderer and CI contract. Replace it with a fresh browser run before using its measurements as application evidence.

## Run metadata

- Started: 2026-08-01T04:00:00.000Z
- Finished: 2026-08-01T04:00:42.000Z
- Duration: 42000 ms
- Tool version: 0.4.0
- Schema version: 1
