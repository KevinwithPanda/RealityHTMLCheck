# RealityCheck audit plan

> PREVIEW ONLY: no browser was opened and the target was not requested.

- Plan: `PLAN-7ED365C56504`
- Target: `http://127.0.0.1:3000/`
- Mode: `deep`
- Maximum pages: 20
- Scenarios per page: 15
- Maximum scenario executions: 301
- Enabled detectors: 12/12

## What will be checked

| Detector | State | Settings | Boundary |
| --- | --- | ---: | --- |
| Runtime and UI baseline | enabled | 6 | Console, request, image, layout, focus, and rendered-state observations. |
| Responsive viewport matrix | enabled | 3 | Each configured viewport runs in a fresh browser context. |
| Deep recovery and accessibility scenarios | enabled | 7 | Preference, degraded API, empty data, and axe-core scenarios run only in deep mode. |
| Declarative product requirements | enabled | 1 | Validated selectors and assertions run without arbitrary project code. |
| Safe user journeys | enabled | 1 | Same-origin declarative steps must include proof and cannot submit forms. |
| Performance budgets | enabled | 4 | Browser performance metrics are compared with explicit numeric limits. |
| Network reliability budgets | enabled | 6 | Counts and timings are retained; response bodies and query values are not. |
| Same-origin link integrity | enabled | 3 | A bounded number of allowed same-origin links are checked with HEAD only. |
| Publishing metadata | enabled | 9 | Presence, length, count, and directive facts are retained without copying page text. |
| Reviewed visual baseline | enabled | 4 | Baselines can change only through a separate explicit approval command. |
| Response and origin security | enabled | 4 | Headers, mixed content, forms, and origin counts are inspected without submission. |
| Aggregate browser-storage privacy | enabled | 7 | Only aggregate cookie and Web Storage counts and bytes are retained. |

## Safety boundaries

- This command did not open a browser, request the target, or modify application code.
- Navigation and declarative journeys remain same-origin and bounded by the route policy.
- RealityCheck does not submit forms, purchase, delete, sign out, or approve releases.
- Repair suggestions and copyable tasks require human review; no fix is applied from this plan.

## Data retention

- **retained** — Audit screenshots and bounded DOM measurements may be written as evidence.
- **not retained** — Response bodies and URL query values are not retained.
- **not retained** — Cookie names, values, storage keys, and storage values are not retained.
- **not retained** — Authentication storage-state paths and values are not copied into the plan or report.
- **not retained** — Private signing keys and credentials remain outside generated evidence.

## Run after review

`realitycheck audit --config examples/audit-plan-lab/realitycheck.config.json`
