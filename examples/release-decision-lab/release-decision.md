# RealityCheck release decision

Decision: **NO-GO** · `RELEASE-D7809A1478C6`

- Generated: 2026-08-04T21:06:37.766Z
- Evidence age limit: 168 hours
- Required controls: `audit`, `policy`, `issues`

## Control decisions

| Control | Required | State | Age | Reason |
| --- | --- | --- | --- | --- |
| Quality gate | yes | **FAIL** | 89.1h | The selected audit did not satisfy its own configured release gate. |
| Policy change guard | yes | **FAIL** | 0.08h | 46 structural policy weakening change(s) were detected. |
| Repair review queue | yes | **REVIEW** | 1h | 1 repair draft(s) need an owner or evidence decision. |

> This decision summarizes selected RealityCheck artifacts; it does not deploy, approve, or prove the absence of defects.
