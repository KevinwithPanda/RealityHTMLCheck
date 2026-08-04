# Report contract

`scripts/report.py init` creates `audit-input.json`. The auditor fills it, and `render` produces sanitized `report.json`, `report.md`, `report.html`, SARIF 2.1.0, JUnit XML, and a repair plan from the same normalized data. `compare` matches two rendered reports by stable fingerprint and writes `verification.json`, bilingual `verification.md`, and a self-contained bilingual `verification.html` dashboard. Multi-page audits and trend aggregation use separate versioned contracts described below.

## Audit plan contract

`audit-plan.json` is a browser-free preview governed by `../assets/audit-plan.schema.json`. Its stable `PLAN-...` ID binds the query-free target, detector-policy fingerprint, effective execution ceiling, detector states, and governance settings. Validation recomputes summary counts and the ID, requires every configured viewport to appear in the built-in scenario set, and rejects contradictory maximum-execution totals.

The artifact may retain a portable config filename, target origin/path, viewport dimensions, detector labels/counts, policy severity, and aggregate governance counts. It must not retain target credentials or query values, route globs, selectors, waiver reasons, authentication-state paths/values, Cookie names/values, Web Storage keys/values, or signing secrets. `target.inspected` is always `false`; use a rendered report, not a plan, for pass/fail claims.

## Top-level fields

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | `"1"` | Locked for the current Beta contract. |
| `toolVersion` | string | Current skill version. |
| `run` | object | ID, mode, timestamps, and duration. |
| `target` | object | Requested/final URL and optional title. |
| `adapter` | object | Name, isolation level, and probed capabilities. |
| `config` | object | `allowRemote`, `failOn`, optional normalized `viewports`, and numeric `qualityGate` / `baselinePolicy` policy. |
| `scenarios` | array | One terminal result per requested scenario. |
| `findings` | array | Baseline-aware, evidence-backed findings. |
| `warnings` | string array | Coverage, isolation, settle, or redaction warnings. |
| `translations` | object | Optional localized top-level warning text. Machine enums remain English. |

## Scenario

Required fields:

```json
{
  "id": "mobile-375",
  "status": "completed-with-findings",
  "durationMs": 842,
  "notes": []
}
```

Allowed statuses are `passed`, `completed-with-findings`, `skipped`, `unsupported`, and `failed`.

When present, `config.viewports` preserves the exact normalized responsive policy used by the run. Each entry has a unique `id`, integer CSS-pixel `width` and `height`, and explicit boolean `touch`. Its ID must correspond to one scenario and its screenshot name. This makes policy drift, per-breakpoint attribution, and later verification inspectable without inferring dimensions from finding prose.

## Finding

Required fields:

```json
{
  "ruleId": "document-horizontal-overflow",
  "scenarioId": "mobile-375",
  "classification": "new",
  "severity": "major",
  "confidence": "high",
  "title": "Checkout action is outside the mobile viewport",
  "summary": "The control begins 612px beyond the 375px viewport.",
  "url": "http://localhost:4173/",
  "selector": "[data-testid=checkout]",
  "measurements": {
    "viewportWidth": 375,
    "elementRight": 987
  },
  "evidence": [
    {
      "type": "screenshot",
      "path": "screenshots/mobile-375.png",
      "label": "Mobile viewport"
    }
  ],
  "reproductionSteps": [
    "Open the page at a 375x812 viewport."
  ],
  "remediation": {
    "summary": "Remove the fixed minimum width and keep the action in flow.",
    "technicalHints": ["Use a responsive grid breakpoint."]
  }
}
```

Optional `id` and `fingerprint` values are generated deterministically when omitted. Evidence paths must be relative to the run directory and cannot contain `..`.

A uniquely matched project routing rule adds optional accountable-team metadata:

```json
{
  "ownership": {
    "id": "web-platform",
    "name": "Web Platform"
  }
}
```

Ownership is preserved in reports, comparisons, site summaries, repair plans, and the artifact catalog. Ambiguous route/rule matches never pick the first team; the finding stays unassigned and the report records a warning.

An active governed exception adds an optional `waiver` object to the finding:

```json
{
  "waiver": {
    "id": "legacy-toolbar-web-42",
    "reason": "Replacement is tracked in WEB-42",
    "owner": "Web Platform",
    "expires": "2027-01-31"
  }
}
```

Waived findings remain part of `findings`, severity counts, screenshots, Markdown, HTML, and comparisons. They do not deduct score or satisfy a quality-gate threshold. `score.waivedFindings` records their count when nonzero. SARIF represents them with an external suppression, while JUnit retains them in scenario output without failing the test case.

Fingerprints use rule ID, scenario ID, normalized URL path, and normalized selector. Measurements are intentionally excluded so a detector keeps the same identity when pixel values change between runs.
Finding IDs and fingerprints must be unique within a report. Aggregate repeated runtime messages or measurements into one finding rather than emitting duplicate cards.

## Policy review contract

`policy-review.json` is a separate `kind: "policy-review"` artifact. It stores safe before/after filenames and SHA-256 policy fingerprints, summary counts, a gate result, and stable `POLICY-*` changes classified as `weakened`, `strengthened`, or `review`. Summary counts and the gate are recomputed during validation; duplicate change IDs or changes attached to equal fingerprints are rejected. The paired Markdown and HTML files are review surfaces, while JSON remains authoritative.

## GitHub issue draft contract

`github-issue-drafts.json` is a separate `kind: "github-issue-drafts"` artifact built from validated repair plans. One `ISSUE-*` draft represents one stable finding fingerprint; repeated observations remain in its `occurrences` array with portable report anchors. Each draft carries severity, confidence, actionable/review/waived disposition, safe labels, optional accountable owner, English/Chinese title and Markdown body, and the original proving acceptance contract. Semantic validation recomputes all summary/lifecycle counts and rejects duplicate IDs or fingerprints. The sibling bilingual Markdown, HTML, and CSV are review/export surfaces. No artifact represents a submitted external issue.

## Release decision contract

`release-decision.json` is a separate `kind: "release-decision"` artifact that selects the newest valid evidence for up to six controls: `audit`, `verification`, `policy`, `trust`, `risk`, and `issues`. Policy records the required control set and maximum evidence age. Each selected control stores a portable source link, SHA-256 digest, optional hashed run fingerprint, observed time, bounded numeric facts, and bilingual reason codes; it does not copy raw run IDs, target URLs, page titles, finding text, waiver reasons, or screenshots. A required missing or stale control and any failed control produce `no-go`; a review state or optional stale control produces `review` when no blocker exists; otherwise the result is `go`. Semantic validation recomputes every summary count and decision, checks missing/selected evidence invariants, and recomputes the stable `RELEASE-*` ID from policy plus selected digests and states. The sibling English/Chinese Markdown and bilingual HTML are review surfaces. They never deploy or approve a release.

Visual policy findings use the ordinary finding contract. `visual-baseline-missing` references `screenshots/visual-current.png`; `visual-regression-threshold` additionally references `visual-approved.png` and `visual-diff.png`. Measurements record current/baseline dimensions, whether dimensions match, changed and total pixels, exact ratio and allowed ratio, per-channel threshold, and mask count. Baseline filesystem paths, mask selector text, URL queries, and fragments are not copied into the report. The evidence manifest hashes each emitted visual file like every other screenshot.

## English and Chinese content

English remains the canonical language for machine-readable fields and all enum values. `target`, each scenario, and each finding may include a `translations.zh-CN` object. The top-level translation object contains localized warnings.

```json
{
  "title": "Checkout action is outside the mobile viewport",
  "translations": {
    "zh-CN": {
      "title": "移动端视口内无法看到结账操作",
      "summary": "固定宽度使主要操作移动到了视口之外。",
      "reproductionSteps": ["使用 375×812 的视口打开页面。"],
      "remediation": {
        "summary": "移除固定最小宽度。",
        "technicalHints": ["使用响应式网格约束。"]
      }
    }
  }
}
```

Translated step, hint, note, and warning arrays must have the same number of items as their canonical counterparts. Missing translations fall back to English in the HTML report. Localization must not change severity, confidence, classification, measurements, rule IDs, finding IDs, or CI behavior.

Allowed finding enums:

- severity: `critical`, `major`, `minor`, `info`
- confidence: `high`, `medium`, `low`
- classification: `existing`, `new`, `worsened`, `resolved`

## Scoring

Severity weights are Critical 20, Major 8, Minor 3, and Info 0. Confidence multipliers are High 1, Medium 0.5, and Low 0. Existing baseline issues receive a 0.5 multiplier. New and worsened issues receive full weight. Resolved findings do not deduct points.

The deterministic scorer caps one rule at 20 points and one scenario at 30 points. Findings are sorted by severity, confidence, rule, and fingerprint before caps are applied. The score is `round(100 - baselinePenalty - chaosPenalty)`, bounded to 0-100.

Low-confidence, resolved, and actively waived findings never trigger the CI threshold.

When `config.qualityGate` is present, the renderer also evaluates `minimumScore`, `minimumCoveragePercent`, and `maxWaivedFindings`. `threshold.coveragePercent` records successfully completed scenarios as a percentage. `threshold.violations` contains zero or more `{code, actual, expected}` objects for `severity-threshold`, `minimum-score`, `minimum-coverage`, or `max-waived-findings`; `threshold.met` is true when any condition fails. Comparison and baseline verification preserve these numeric policy conditions.

For regression-only verification, `config.baselinePolicy.maxAgeDays` can add a `baseline-age` violation. `requireSamePolicy` compares optional `config.policyFingerprint` values and adds `policy-drift` when missing or different, preventing detector removal/configuration changes from producing false resolutions. The fingerprint covers tool version, scenario mode, declarative checks, journeys, performance budgets, network reliability limits, link policy, publishing metadata policy, visual policy, security policy, and aggregate browser-storage privacy budgets after canonical ordering; it excludes the derived machine-local visual baseline path and does not expose raw policy content. Verification records baseline ages and before/after fingerprints even when checks pass. Strict historical comparison does not enforce baseline governance.

Aggregate privacy findings use the ordinary finding contract with rule IDs prefixed `privacy-`. `measurements` and `privacy-budget` evidence contain only the configured metric, actual/limit values, and an aggregate object with availability, Cookie count/bytes/third-party count, and localStorage/sessionStorage entry/byte totals. Cookie names/values and Web Storage keys/values are never present. A configured but unreadable surface produces `privacy-storage-measurement-unavailable` with bounded surface names rather than an inferred pass.

Semantic response-header findings use rule IDs prefixed `security-header-policy-`. `measurements` and `response-header-policy` evidence carry the header name, controlled violation codes, bounded parsed facts, and `rawValueRetained: false`. CSP facts contain recognized directive names plus configured forbidden-token categories only; HSTS facts contain numeric max-age and booleans; X-Content-Type-Options contains a nosniff boolean; Referrer-Policy contains recognized standard enum values or `unrecognized`; Permissions-Policy contains controlled declared/disabled/missing feature names. Raw header strings, CSP origins, Permissions-Policy allowlist origins, nonces, hashes, and unrecognized token text must never enter the report.

## Redaction and rendering

The renderer:

- redacts sensitive object keys and URL query parameters;
- redacts bearer tokens and JWT-like values in strings;
- truncates long strings;
- rejects absolute or escaping evidence paths;
- HTML-escapes user-controlled values before Markdown and HTML rendering;
- applies a restrictive Content Security Policy to the visual report;
- writes files atomically.

Treat `report.json` as the machine-readable contract, `report.md` as the portable GitHub review surface, and `report.html` as the self-contained responsive presentation surface. The HTML view contains a small inline script for language switching, filtering, local selection, and clipboard actions. It contains no remote assets and performs no network requests. Per-finding and batch repair buttons only prepare scoped Codex prompts from stable IDs and proving scenarios; they never edit application source directly or inject arbitrary page text into a task.

`report.sarif` maps each active finding to a SARIF rule/result with stable partial fingerprints for code-scanning ingestion. `report.junit.xml` maps scenarios to test cases: failed scenarios and threshold-matching findings fail the suite, while skipped and unsupported scenarios remain skipped rather than being counted as passes.

## Before/after verification

Run:

```bash
python scripts/report.py compare <before-report.json> <after-report.json> --fail-on major
```

A before finding is `resolved` only when its fingerprint is absent from the after report and its original proving scenario finished as `passed` or `completed-with-findings`. If that scenario is skipped, unsupported, or failed, the finding is `unverified`. The comparison also lists remaining, worsened, and newly introduced fingerprints. Strict comparison applies the threshold to the complete after report plus unverified debt. Regression-only comparison applies it to new, worsened, and unverified findings. New verification writers include start/finish timestamps, mode, tool version, and optional detector-policy fingerprint in both run summaries so the proof is independently auditable; readers must continue accepting older ID/score-only summaries.

## Repair, site, trend, and catalog contracts

- `repair-plan.json` (`kind: "repair-plan"`) is a bounded machine handoff for every active finding. It retains the stable fingerprint, rule, severity/confidence, accountable owner when assigned, report anchor, remediation, required baseline/proving scenarios, and explicit acceptance flags. It can include a visible waiver but never authorizes code edits or claims that a repair occurred. `repair-plan.md` is the human checklist view.

- `site-report.json` (`kind: "site-audit"`) records bounded discovery, aggregate score and severity counts, per-page status, stable finding summaries, scenario statuses, and portable links to each page's full report.
- `site-verification.json` (`kind: "site-verification"`) matches page paths and finding fingerprints across two site runs. It distinguishes resolved, remaining, worsened, new, and unverified findings plus failed, added, and removed pages.
- `trend.json` (`kind: "quality-trend"`) groups exact target URLs into time-ordered series containing score, quality-gate status, severity counts, scenario coverage, and a portable latest-report link.
- `catalog.json` (`kind: "artifact-catalog"`) is a validated local index of page audits, site audits, page/site verification proofs, trends, repair plans, issue-draft boards, policy reviews, and signed/trusted evidence. Its entries contain portable paths to the machine artifact and best available visual view. The sibling bilingual `catalog.html` supports state/type filters and local search across targets, IDs, and owners; `catalog.md` is suitable for a CI job summary.
- `latest.json` (`kind: "latest-run"`) is a stable output-root pointer to the newest fully rendered page or site workflow. It records gate state, score, target, run ID, optional page count, and portable report/repair/verification/integrity paths. Signing or evaluating trust for that same current run adds portable receipt/decision links; historical operations cannot move the pointer. The sibling bilingual `latest.html` is safe to bookmark. Timestamped history remains immutable, and an interrupted workflow must not replace the pointer.
- `evidence-manifest.json` (`kind: "evidence-manifest"`) lists every file in one completed timestamped run with a portable path, byte count, media type, and SHA-256 digest. Validation recomputes bytes and hashes and fails on missing or changed evidence. The manifest detects archive mutation but does not authenticate the publisher.
- `evidence-attestation.json` (`kind: "evidence-attestation"`) binds the sibling manifest's exact bytes to an embedded Ed25519 public key and stable SHA-256 key ID. Semantic validation rechecks manifest bytes, digest, key ID, and signature. The signature proves private-key possession; associating the key ID with an organization requires an external trust policy.
- `evidence-trust.json` (`kind: "evidence-trust-policy"`) is a versionable public-key registry. Each named key has a trusted/revoked state and optional UTC validity window; the policy can require signatures beside all manifests. Duplicate IDs, invalid windows, and policies with no active trusted key are rejected conservatively.
- `evidence-trust-report.json` (`kind: "evidence-trust-report"`) records a trusted/rejected archive decision, the exact policy digest, and separate SHA-256 integrity, Ed25519 signature, and signer-authorization booleans. Semantic validation enforces consistent state/check/error relationships. The sibling bilingual HTML explains the decision for human review, and the artifact catalog indexes it as passed or failed evidence.
- `risk-register.json` (`kind: "risk-register"`) deduplicates observations by exact target plus stable finding fingerprint across validated page reports. Its summary separates recurring and overdue risks from lifecycle state, while each risk records open/waived/resolved/unverified state, severity/confidence, rule/scenario, first/last seen, occurrence count, age, overdue state, optional ownership/waiver, and portable latest/evidence links. Optional maximum open age and recurring-risk limits produce machine-readable policy violations and a gate result. Resolution requires a later successful proving scenario and, when policy fingerprints are available, matching detector policy; otherwise `unverifiedReason` identifies scenario incompleteness or policy drift. Sibling HTML, Markdown, and formula-injection-safe CSV support operational review.
- `github-summary.md` is a bounded GitHub-flavored Markdown handoff built only from schema-valid page reports. It selects the newest report for each exact requested target, strips query and fragment values from display, counts but does not annotate waived findings, sorts active findings by severity/confidence, and caps workflow annotations at 50. Annotation data normalizes controls and command-looking `::` sequences, escapes `%` and command properties, and never claims a source-file location that the browser evidence does not prove.

The published schemas are:

- `assets/report.schema.json`
- `assets/verification.schema.json`
- `assets/site-report.schema.json`
- `assets/site-verification.schema.json`
- `assets/trend.schema.json`
- `assets/catalog.schema.json`
- `assets/repair-plan.schema.json`
- `assets/latest-run.schema.json`
- `assets/evidence-manifest.schema.json`
- `assets/evidence-attestation.schema.json`
- `assets/evidence-trust.schema.json`
- `assets/evidence-trust-report.schema.json`
- `assets/risk-register.schema.json`
- `assets/policy-review.schema.json`
- `assets/issue-drafts.schema.json`
- `assets/release-decision.schema.json`

Validate a file or directory recursively with `scripts/audit.mjs validate`. `--require-attestation` requires a sibling signature for every discovered evidence manifest and validates that signature automatically; repeat `--trusted-key sha256:...` to restrict accepted signer keys. Exit code `0` means every recognized artifact satisfies schema, semantic integrity, signature, and requested trust policy; `1` means at least one artifact failed; `2` means the command itself could not run or found no artifacts.

Schema version 1 verification readers must accept the v0.2 shape where `worsened` and `threshold.scope` are absent. Writers from v0.3 onward always emit those fields. Adding the optional fields was backward compatible; consumers should treat an absent `worsened` list/count as empty and an absent scope as strict all-active-findings behavior.
