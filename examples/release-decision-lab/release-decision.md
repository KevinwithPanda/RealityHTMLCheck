# RealityCheck release decision

Decision: **NO-GO** · `RELEASE-1C410472D2D2`

- Generated: 2026-08-04T20:42:04.553Z
- Evidence age limit: 168 hours
- Required controls: `audit`, `policy`, `issues`

## Control decisions

| Control | Required | State | Age | Reason |
| --- | --- | --- | --- | --- |
| Quality gate | yes | **FAIL** | 88.69h | The selected audit did not satisfy its own configured release gate. |
| Policy change guard | yes | **FAIL** | 0.89h | 38 structural policy weakening change(s) were detected. |
| Repair review queue | yes | **REVIEW** | 0.59h | 1 repair draft(s) need an owner or evidence decision. |

> This decision summarizes selected RealityCheck artifacts; it does not deploy, approve, or prove the absence of defects.
