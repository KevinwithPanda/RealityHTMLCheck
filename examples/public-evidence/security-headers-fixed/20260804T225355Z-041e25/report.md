# RealityCheck report

- **Score:** 100/100
- **Target:** `http://127.0.0.1:4193/fixed`
- **Mode:** quick
- **Adapter:** project-playwright (fresh-context)
- **Run:** `20260804T225355Z-041e25`
- **Threshold:** major - PASSED

> Automated checks cover only the recorded scenarios and cannot prove the absence of bugs or complete WCAG compliance.

## Summary

| Critical | Major | Minor | Info | Baseline penalty | Chaos penalty |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0.0 | 0.0 |

## Scenarios

| Scenario | Status | Duration | Notes |
| --- | --- | ---: | --- |
| `baseline` | passed | 769 ms | - |
| `mobile-375` | passed | 592 ms | Evaluated 375×812; touch-target checks were enabled. |
| `long-text` | passed | 1053 ms | 1 deterministic text mutations were applied. |
| `rtl-arabic` | passed | 993 ms | Directionality stress test only; translation quality was not assessed. |
| `image-failure` | passed | 614 ms | Expected image request aborts were excluded from failed-request findings. |
| `keyboard-tab` | passed | 709 ms | No controls were activated or submitted. |

## Findings

No evidence-backed findings were recorded.

## Coverage warnings

- Standalone audit used an already-installed system browser (150.0.7871.116).
- Automated findings remain bounded observations; review low-confidence items before fixing.
- Responsive layout was evaluated in 1 configured viewport(s); touch-target heuristics ran only where touch was enabled.
- 6 explicit response, semantic-header, origin, and form security policy setting(s) were evaluated without submitting data or retaining raw header values.

## Run metadata

- Started: 2026-08-04T22:53:55.721Z
- Finished: 2026-08-04T22:54:00.558Z
- Duration: 4815 ms
- Tool version: 0.4.0
- Schema version: 1
