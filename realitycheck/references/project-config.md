# Project configuration

`realitycheck.config.json` is the versioned policy for repeatable local and CI audits. List transparent starting policies with `realitycheck profiles`, create one with `realitycheck init --profile starter|product|strict --base-url URL`, then run `realitycheck doctor` before the first browser audit.

## Validated starting profiles

- `starter` keeps Quick mode, one 375x812 viewport, and crawling off while adding a bounded 25-target link check, essential title/viewport/language rules, and a forgiving release score.
- `product` enables Deep mode, 360x800 phone plus 768x1024 tablet checkpoints, a 20-page safe crawl, performance/API/link/publishing/security/browser-storage privacy policies, and a 30-day same-policy baseline rule.
- `strict` checks 320x700 and 390x844 phones plus a 768x1024 tablet, tightens performance and aggregate browser-storage budgets, audits all resource requests, requires five reviewed response headers, and permits no active waivers. It is expected to reveal adoption work.

Profiles generate ordinary JSON with no hidden behavior. They never prove legal, regulatory, security, accessibility, or performance compliance. Review every threshold, required header, route boundary, and exclusion for the application before CI enforcement. `--base-url` rejects credentials, query strings, fragments, and non-HTTP(S) protocols so initialization cannot persist URL secrets.

## Resolution and precedence

- An explicit `--config PATH` wins.
- Otherwise the CLI searches the current directory and its parents for `realitycheck.config.json`.
- CLI values override config values.
- Paths written in the config (`output`) resolve beside the config file; paths supplied on the CLI resolve from the current working directory.
- `baseUrl` must be HTTP(S). Public or unresolved hosts still require explicit authorization and `--allow-remote`.

## Responsive viewport matrix

`viewports` defines one to six isolated responsive checkpoints. IDs must be unique lowercase slugs, dimensions must be unique, width is bounded to 240-2560 CSS pixels, and height to 320-2560. IDs cannot collide with built-in or journey scenario names.

```json
{
  "viewports": [
    { "id": "phone-320", "width": 320, "height": 700, "touch": true },
    { "id": "phone-390", "width": 390, "height": 844, "touch": true },
    { "id": "tablet-768", "width": 768, "height": 1024, "touch": true }
  ]
}
```

Each checkpoint gets a fresh context, a scenario with the same ID, and `screenshots/<id>.png`. It compares layout against the desktop baseline, reports newly unreachable controls and horizontal overflow, and runs the conservative 24x24 target-size heuristic only when `touch` is true. `touch` does not emulate a mobile user agent, branded device, or gestures. When omitted, the matrix defaults to `mobile-375` at 375x812 with touch-target checks enabled. Viewport membership, IDs, dimensions, and touch settings are included in the detector-policy fingerprint; list ordering is canonicalized so harmless reordering does not create drift.

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

Journeys prove small read-only user workflows without accepting executable config. Each journey has a stable ID, same-origin `startPath`, severity, and 1–50 ordered steps. At least one step must be an `assert` or `assert-url`.

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
        { "action": "press", "selector": "[role=tab][aria-controls=general]", "key": "ArrowRight" },
        { "action": "assert", "selector": "#notifications", "assertion": "visible" },
        { "action": "goto", "path": "/profile" },
        { "action": "assert-url", "path": "/profile" },
        { "action": "assert", "selector": "h1", "assertion": "accessible-name" }
      ]
    }
  ]
}
```

`goto` accepts only absolute paths on the audited origin and obeys the merged crawl exclusions. `assert-url` compares the current pathname exactly and never records a query or fragment. `click` must match exactly one same-origin link, tab, disclosure, or non-submit button explicitly marked `data-realitycheck-safe="true"`. Labels suggesting delete, purchase, payment, submission, sending, logout, or unsubscribe are refused even when marked.

`press` must match exactly one non-editable structural widget (`tab`, `tablist`, `menu`, `menuitem`, `dialog`, `tree`, `treeitem`, `grid`, `row`, `body`) or an explicitly safe element. Only `Escape`, arrow keys, `Home`, `End`, `Tab`, and `Shift+Tab` are accepted. Activation and text-entry keys such as Enter, Space, and printable characters are rejected before navigation. The runner never fills inputs or submits forms. It saves a screenshot after every completed step, stops at the first failure, and creates one evidence-backed journey finding with a bounded step trace.

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

## Publishing metadata contract

Metadata checks are opt-in release rules evaluated in the clean baseline. Define at least one rule; `severity` defaults to `major`.

```json
{
  "metadata": {
    "titleMinLength": 10,
    "titleMaxLength": 70,
    "descriptionMinLength": 50,
    "descriptionMaxLength": 180,
    "requireCanonical": true,
    "requireViewport": true,
    "requireLang": true,
    "forbidNoindex": true,
    "requireSingleH1": true,
    "severity": "major"
  }
}
```

Length limits accept 0 to 1000 and each configured minimum must not exceed its maximum. Title and description rules require exactly one matching element as well as an in-range rendered length. `requireCanonical` requires one absolute HTTP(S) destination; `requireViewport` requires one declaration containing `width=device-width`; `requireLang` accepts a non-empty BCP 47-shaped root language; `forbidNoindex` flags an explicit robots noindex directive; and `requireSingleH1` requires exactly one primary heading.

Detector evidence stores counts, lengths, booleans, and query-free canonical origin/pathname fields. It never retains title or description copy. The normal report target still includes the browser document title, so do not describe the entire report as title-free. A missing language uses the existing `document-language-missing` detector rather than creating a duplicate metadata finding. These checks enforce a declared publishing contract; they do not prove SEO performance, indexing, content quality, or accessibility conformance. Removing `noindex` always requires a human decision that the route is intended for public indexing.

## Explicit visual regression baselines

Visual policy captures a second deterministic full-page baseline snapshot with animations disabled and caret hidden, then compares it with an explicitly approved PNG for the exact URL pathname. The directory must be a relative child path of the config directory; absolute paths, parent traversal, and symbolic-link traversal are rejected.

```json
{
  "visual": {
    "baselineDirectory": ".realitycheck/visual-baselines",
    "maxDiffRatio": 0.002,
    "pixelThreshold": 28,
    "masks": [".current-time", "[data-dynamic]"],
    "severity": "major"
  }
}
```

`maxDiffRatio` is required and accepts 0 to 1; `0.002` means at most 0.2% of pixels may change. `pixelThreshold` defaults to 32 and accepts 0 to 255; a pixel changes when any RGBA channel differs by more than that value. Up to 20 unique CSS selectors may be listed in `masks`; matching areas receive the same fixed magenta mask in both images. Invalid selectors make the explicit check unusable instead of silently disabling a mask. Screenshots are limited to 12 MiB and 20 million decoded pixels per image.

The first audit produces `visual-baseline-missing` plus `screenshots/visual-current.png`. After reviewing that image, explicitly approve it:

```bash
realitycheck visual-approve .realitycheck/runs/RUN/report.json --config realitycheck.config.json
```

Approval records a pathname-keyed PNG plus `visual-baseline-index.json` containing SHA-256, source run ID, and approval time. Host, port, query, and fragment do not affect the key, so the same route can move between local and staging origins without persisting URL secrets. If another PNG already exists, the command is idempotent only when bytes match; a different image is rejected until the reviewer deliberately adds `--replace-baseline`. Ordinary `audit`, `fix`, and comparison flows never update baselines.

A threshold failure emits `visual-current.png`, `visual-approved.png`, and `visual-diff.png` with changed pixels in magenta. Keep the approval and comparison environment consistent across browser version, operating system, installed fonts, device scale, and viewport. This is a bounded exact-pixel detector with a per-channel tolerance, not a perceptual model. Passing proves rendering stability against the approved image, not that the approved design is correct, usable, accessible, or responsive. Mask only reviewed dynamic regions and never increase thresholds or approve a regression solely to make CI green.

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

## Aggregate browser storage privacy budgets

Browser storage privacy checks are opt-in project budgets evaluated after the clean baseline settles. Define at least one limit; `severity` defaults to `major`.

```json
{
  "privacy": {
    "maxCookies": 20,
    "maxCookieBytes": 8192,
    "maxThirdPartyCookies": 5,
    "maxLocalStorageEntries": 50,
    "maxLocalStorageBytes": 262144,
    "maxSessionStorageEntries": 30,
    "maxSessionStorageBytes": 131072,
    "severity": "major"
  }
}
```

Cookie count accepts 0 to 500, cookie bytes 0 to 1,000,000, Web Storage entry counts 0 to 10,000, and Web Storage byte totals 0 to 10,000,000. Byte totals are UTF-8 bytes across each key/value pair; Cookie bytes count each name and value. A Cookie is first-party when its normalized domain is the final document host or a parent domain of that host. Every scenario starts in a fresh browser context, so the observation covers state created or loaded for that isolated baseline, including an explicitly supplied storage state.

Evidence contains only availability, counts, byte totals, actual limits, and a screenshot. It intentionally never contains Cookie names or values, localStorage/sessionStorage keys or values, or browser exception text. If a configured surface cannot be measured, the audit produces `privacy-storage-measurement-unavailable` instead of treating the missing value as zero. Passing proves only that this route stayed inside the reviewed aggregate budgets in this isolated run. It is not a consent audit, tracker classifier, retention audit, data-flow inspection, or legal compliance claim. Remove or migrate application state only after product/security review; the audit never clears storage automatically.

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

`maxAgeDays` is an integer from 1 to 3650. Age is measured from the baseline run's `finishedAt` to the new run's `startedAt`, so copying a file does not make old evidence fresh. `requireSamePolicy` compares SHA-256 fingerprints derived from tool version, scenario mode, declarative checks, journeys, performance budgets, network reliability limits, link policy, publishing metadata policy, visual policy, security policy, and aggregate browser-storage privacy budgets; property/list ordering is canonicalized, derived machine-local baseline paths are excluded, and raw selectors or policy content are not copied into the report. Missing or different fingerprints produce `policy-drift` instead of a false resolution. At least one policy must be active. These gates are enforced only for `--baseline`; `--compare` remains an unrestricted historical analysis tool.

## Authenticated pages

Pass an existing Playwright storage-state JSON file with `--storage-state PATH` or the `REALITYCHECK_STORAGE_STATE` environment variable. The CLI validates its top-level `cookies` and `origins` arrays, then loads it into each isolated context. It does not persist the path or any stored value.

Use a least-privileged test account. Do not commit storage-state files, print them in CI logs, or use production admin sessions.

## Review policy changes before merging

Use a separately captured base-branch config and the proposed config. The review never reads Git history itself, so the caller controls exactly which two trusted files are compared:

```bash
realitycheck policy-review \
  /tmp/realitycheck-main.config.json \
  realitycheck.config.json \
  --output .realitycheck/policy-review
```

Both inputs must pass the config contract. The command compares effective defaults plus explicit responsive, coverage, detector, performance, browser-storage privacy, release-gate, baseline, security, ownership, and exception settings. It writes `policy-review.json`, English and Chinese Markdown, and one offline bilingual HTML view. Any `weakened` change makes the gate exit `1`; `review` changes remain visible but need human approval because route-glob overlap, breakpoint market coverage, selector intent, and legal/product requirements are not safe to infer. Exit `2` means invalid input or rendering failure.

The review is deliberately metadata-minimal: source entries contain basenames and SHA-256 policy fingerprints, while changes contain stable IDs, categories, keys, counts/safe scalar values, and bounded bilingual rationales. It does not copy base URLs, filesystem paths, route patterns, selectors, custom titles/remediation, allowed origins, waiver reasons, or other arbitrary configuration text.
