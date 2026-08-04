# Project configuration

`realitycheck.config.json` is the versioned policy for repeatable local and CI audits. Create a safe template with `realitycheck init`, then run `realitycheck doctor` before the first browser audit.

## Resolution and precedence

- An explicit `--config PATH` wins.
- Otherwise the CLI searches the current directory and its parents for `realitycheck.config.json`.
- CLI values override config values.
- Paths written in the config (`output`) resolve beside the config file; paths supplied on the CLI resolve from the current working directory.
- `baseUrl` must be HTTP(S). Public or unresolved hosts still require explicit authorization and `--allow-remote`.

## Routes and safe discovery

`routes` adds exact same-origin pages. `crawl.enabled` follows page links from `baseUrl` and configured routes up to `maxPages` (1–100) and `maxDepth` (0–8).

```json
{
  "routes": ["/", "/settings"],
  "crawl": {
    "enabled": true,
    "maxPages": 20,
    "maxDepth": 2,
    "include": ["/app/**"],
    "exclude": ["/app/billing/checkout/**"]
  }
}
```

Glob rules are path-only: `*` stays within one segment and `**` crosses segments. Discovery keeps the target origin, strips queries and hashes, skips asset extensions, and does not click controls or submit forms. Default exclusions cover logout, signout, delete, remove, unsubscribe, purchase, checkout, and OAuth route segments after bounded percent-decoding and case normalization. These defaults are always merged with project exclusions rather than replaced. Add project-specific destructive routes instead of trying to remove the built-in boundary.

## Declarative checks

Each rule has a stable lowercase `id`, a CSS `selector`, an `assertion`, and an optional severity/title/remediation. `include` and `exclude` route globs default to all routes and none respectively.

| Assertion | Meaning | Useful options |
| --- | --- | --- |
| `exists` | At least the expected elements exist | `min` |
| `visible` | Enough matching elements are visible | `min` |
| `enabled` | Enough matching controls are enabled | `min` |
| `accessible-name` | Every match exposes an accessible name | `min` |
| `attribute` | Every match has/matches an attribute | `attribute`, `equals`, `contains`, `min` |
| `count` | Match count stays within bounds | `min`, `max` |
| `no-horizontal-overflow` | Matches do not overflow their own box | `min` |
| `minimum-size` | Visible matches meet a CSS-pixel size | `min`, `minWidth`, `minHeight` |

```json
{
  "checks": [
    {
      "id": "checkout-visible",
      "selector": "[data-testid=checkout]",
      "assertion": "visible",
      "severity": "critical",
      "title": "Checkout must remain available",
      "titleZh": "结账入口必须保持可用",
      "include": ["/cart", "/checkout/**"]
    },
    {
      "id": "icon-target-size",
      "selector": ".toolbar .icon-button",
      "assertion": "minimum-size",
      "severity": "minor",
      "options": { "minWidth": 44, "minHeight": 44 }
    }
  ]
}
```

Unknown fields and executable assertions are rejected before browser navigation. A failing rule becomes a normal finding with measurements, evidence, route, and a remediation task.

## Safe declarative journeys

Journeys prove small read-only user workflows without accepting executable config. Each journey has a stable ID, same-origin `startPath`, severity, and 1–50 ordered steps. At least one step must be an `assert`.

```json
{
  "journeys": [
    {
      "id": "settings-notifications",
      "title": "Settings notifications remain usable",
      "startPath": "/settings",
      "severity": "major",
      "steps": [
        { "action": "assert", "selector": "[role=tab]", "assertion": "count", "options": { "min": 2 } },
        { "action": "click", "selector": "[role=tab][aria-controls=notifications]" },
        { "action": "assert", "selector": "#notifications", "assertion": "visible" },
        { "action": "goto", "path": "/profile" },
        { "action": "assert", "selector": "h1", "assertion": "accessible-name" }
      ]
    }
  ]
}
```

`goto` accepts only absolute paths on the audited origin and obeys the merged crawl exclusions. `click` must match exactly one same-origin link, tab, disclosure, or non-submit button explicitly marked `data-realitycheck-safe="true"`. Labels suggesting delete, purchase, payment, submission, sending, logout, or unsubscribe are refused even when marked. The runner never fills inputs or submits forms. It saves a screenshot after every completed step, stops at the first failure, and creates one evidence-backed journey finding with a bounded step trace.

## Performance budgets

Budgets run in the clean baseline context. Define at least one numeric limit:

```json
{
  "budgets": {
    "navigationMs": 2500,
    "domContentLoadedMs": 1800,
    "ttfbMs": 800,
    "firstContentfulPaintMs": 1800,
    "largestContentfulPaintMs": 2500,
    "cumulativeLayoutShift": 0.1,
    "requests": 80,
    "transferKb": 1500,
    "domNodes": 1800,
    "severity": "major"
  }
}
```

TTFB, FCP, and LCP use integer milliseconds. CLS accepts a finite number from 0 to 100. LCP and CLS observers are installed before navigation so buffered entries are available after the page settles. Transfer size depends on browser timing availability and server headers. Treat every value as a browser observation, not a billing or field-RUM measurement. Never increase a budget solely to clear a quality gate.

## Network reliability budgets

Network policy runs in the clean baseline context and is opt-in. Set `scope` to `api` (the default, covering XHR and fetch) or `all`, then define at least one maximum:

```json
{
  "network": {
    "scope": "api",
    "maxHttpErrors": 0,
    "maxFailedRequests": 0,
    "slowRequestMs": 1000,
    "maxSlowRequests": 1,
    "maxThirdPartyRequests": 2,
    "severity": "major"
  }
}
```

`maxHttpErrors` counts in-scope HTTP 4xx/5xx responses. `maxFailedRequests` counts requests that fail before any HTTP response. `slowRequestMs` and `maxSlowRequests` must be configured together; a request is slow only when its observed duration is strictly above the threshold. `maxThirdPartyRequests` counts request occurrences whose origin differs from the final document origin, not just unique origins. Limits accept 0 to 10,000, while the slow threshold accepts 1 to 120,000 milliseconds.

Evidence never retains response bodies. Sampled URLs have credentials, fragments, and complete query strings removed before the audit input is written; samples are capped at ten per finding. Use the separate security origin allowlist when the question is whether a third party is approved. Use this policy when the question is whether request failures, latency, or dependency volume may block a release.

## Same-origin link integrity

Link policy runs after the clean baseline settles. It collects anchors without activating them and checks eligible same-origin targets with `HEAD` only:

```json
{
  "links": {
    "maxFailures": 0,
    "maxChecked": 50,
    "timeoutMs": 5000,
    "severity": "major"
  }
}
```

`maxFailures` is required and accepts 0 to 100. `maxChecked` defaults to 50 and is capped at 100; `timeoutMs` defaults to 5000 and accepts 500 to 15000. The checker removes credentials, queries, and fragments, deduplicates targets, and runs at most five requests concurrently. It follows no more than five redirects, stops before leaving the audited origin, and applies the merged crawl include/exclude policy to both initial and redirected paths. A redirect to an external origin is a failure; a route excluded for logout, purchase, deletion, unsubscribe, checkout, or OAuth is skipped without being contacted. `HEAD` 405/501 is reported as unsupported rather than broken. No GET fallback exists, so link checking cannot download a linked document or trigger a GET-only business action.

## Security baseline

Security checks are opt-in because localhost and production delivery policies differ. Define at least one policy; `severity` defaults to `major`.

```json
{
  "security": {
    "requiredHeaders": ["content-security-policy", "x-content-type-options", "referrer-policy"],
    "forbidMixedContent": true,
    "secureForms": true,
    "maxThirdPartyOrigins": 3,
    "allowedThirdPartyOrigins": ["https://cdn.example.com"],
    "severity": "major"
  }
}
```

Supported response headers are `content-security-policy`, `strict-transport-security`, `x-content-type-options`, `referrer-policy`, and `permissions-policy`. Header checks record presence only, not values. `secureForms` inspects password fields, form methods, and resolved action protocols without reading or submitting field values; loopback HTTP remains trusted except that passwords sent through GET are still reported. Third-party policy stores only unique origins, never resource paths or query parameters. Allowed origins must be exact HTTPS origins without credentials, paths, queries, or fragments.

## Finding ownership

`owners` assigns active findings to accountable teams using stable rule IDs and path-only route globs. Each entry must declare a stable lowercase `id`, a display `name`, and at least one routing constraint. `ruleIds` matches exact detector/custom-rule IDs; `include` and `exclude` use the same `*` / `**` path semantics as crawl policy.

```json
{
  "owners": [
    {
      "id": "web-platform",
      "name": "Web Platform",
      "ruleIds": ["document-horizontal-overflow", "custom-primary-navigation-named"],
      "include": ["/app/**"],
      "exclude": ["/app/billing/**"]
    }
  ]
}
```

Exactly one matching entry writes `ownership: {id, name}` to the finding. That metadata follows the finding into page/site reports, comparisons, repair plans, and the evidence catalog. Zero matches remain unassigned. Multiple matches also remain unassigned and add an ambiguity warning; refine the route or rule constraints instead of relying on declaration order. Ownership does not suppress a finding, alter score, or grant permission to edit source.

## Governed waivers

A waiver keeps a known finding and all of its evidence visible while temporarily excluding it from score and quality-gate calculations. Every waiver must match an exact `ruleId` and include a stable ID, a concrete reason, and an ISO expiry date. Add an owner whenever a team is accountable for the follow-up. Optional selector and route filters keep the exception narrow.

```json
{
  "waivers": [
    {
      "id": "legacy-toolbar-web-42",
      "ruleId": "custom-toolbar-minimum-size",
      "selector": ".legacy-toolbar button",
      "reason": "Replacement is tracked in WEB-42",
      "owner": "Web Platform",
      "expires": "2027-01-31",
      "include": ["/legacy/**"]
    }
  ]
}
```

An expired waiver is ignored during an audit, so the finding affects score and gate again. `realitycheck doctor` treats any expired configured waiver as a preflight failure. Reports show the waiver beside the original finding; SARIF uses an external suppression and JUnit does not fail on the waived result. Never use a waiver to conceal evidence or create an exception without a scheduled review.

## Release policy gates

`failOn` blocks active high-confidence findings at or above a severity. An optional `qualityGate` adds numeric release conditions that remain active even when `failOn` is `never`:

```json
{
  "failOn": "major",
  "qualityGate": {
    "minimumScore": 90,
    "minimumCoveragePercent": 90,
    "maxWaivedFindings": 2
  }
}
```

- `minimumScore` is the minimum deterministic page score, from 0 to 100.
- `minimumCoveragePercent` is the minimum percentage of scenarios ending as `passed` or `completed-with-findings`.
- `maxWaivedFindings` limits active governed exceptions; it does not hide or delete them.

All values are integer percentages/counts from 0 to 100. The report records `threshold.coveragePercent` and one machine-readable entry per failed condition in `threshold.violations`. HTML explains those conditions in English and Chinese. Page, site, strict comparison, and regression-only baseline gates preserve the numeric policy; comparison scope changes which findings count as regressions, not whether release policy exists.

## Baseline freshness

An optional `baselinePolicy` prevents a regression-only `--baseline` from preserving known debt forever:

```json
{
  "baselinePolicy": {
    "maxAgeDays": 30,
    "requireSamePolicy": true
  }
}
```

`maxAgeDays` is an integer from 1 to 3650. Age is measured from the baseline run's `finishedAt` to the new run's `startedAt`, so copying a file does not make old evidence fresh. `requireSamePolicy` compares SHA-256 fingerprints derived from tool version, scenario mode, declarative checks, journeys, performance budgets, network reliability limits, link policy, and security policy; property/list ordering is canonicalized, and raw selectors or policy content are not copied into the report. Missing or different fingerprints produce `policy-drift` instead of a false resolution. At least one policy must be active. These gates are enforced only for `--baseline`; `--compare` remains an unrestricted historical analysis tool.

## Authenticated pages

Pass an existing Playwright storage-state JSON file with `--storage-state PATH` or the `REALITYCHECK_STORAGE_STATE` environment variable. The CLI validates its top-level `cookies` and `origins` arrays, then loads it into each isolated context. It does not persist the path or any stored value.

Use a least-privileged test account. Do not commit storage-state files, print them in CI logs, or use production admin sessions.
