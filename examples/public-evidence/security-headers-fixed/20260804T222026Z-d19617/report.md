# RealityCheck report

- **Score:** 100/100
- **Target:** `http://127.0.0.1:4193/fixed`
- **Mode:** quick
- **Adapter:** project-playwright (fresh-context)
- **Run:** `20260804T222026Z-d19617`
- **Threshold:** major - PASSED

> Automated checks cover only the recorded scenarios and cannot prove the absence of bugs or complete WCAG compliance.

## Summary

| Critical | Major | Minor | Info | Baseline penalty | Chaos penalty |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0.0 | 0.0 |

## Scenarios

| Scenario | Status | Duration | Notes |
| --- | --- | ---: | --- |
| `baseline` | passed | 608 ms | - |
| `mobile-375` | passed | 562 ms | Evaluated 375×812; touch-target checks were enabled. |
| `long-text` | passed | 988 ms | 1 deterministic text mutations were applied. |
| `rtl-arabic` | passed | 988 ms | Directionality stress test only; translation quality was not assessed. |
| `image-failure` | passed | 599 ms | Expected image request aborts were excluded from failed-request findings. |
| `keyboard-tab` | passed | 705 ms | No controls were activated or submitted. |

## Findings

No evidence-backed findings were recorded.

## Coverage warnings

- Standalone audit used an already-installed system browser (150.0.7871.116).
- Automated findings remain bounded observations; review low-confidence items before fixing.
- Responsive layout was evaluated in 1 configured viewport(s); touch-target heuristics ran only where touch was enabled.
- 5 explicit response, semantic-header, origin, and form security policy setting(s) were evaluated without submitting data or retaining raw header values.

## Run metadata

- Started: 2026-08-04T22:20:26.940Z
- Finished: 2026-08-04T22:20:31.487Z
- Duration: 4536 ms
- Tool version: 0.4.0
- Schema version: 1
