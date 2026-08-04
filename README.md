<div align="center">
  <img src="docs/assets/hero.svg" alt="RealityCheck — break your localhost, fix what breaks, prove the fix" width="100%" />
</div>

<p align="center">
  <strong>Break your localhost. Fix what breaks. Prove the fix.</strong><br />
  One Codex prompt turns real browser stress states into evidence, bounded repairs, and before/after proof.
</p>

<p align="center">
  <a href="https://kevinwithpanda.github.io/RealityHTMLCheck/"><strong>Live demo</strong></a> ·
  <a href="docs/README.zh-CN.md">中文</a> ·
  <a href="#one-prompt">One prompt</a> ·
  <a href="examples/index.html">Demo center</a> ·
  <a href="#standalone-cli">CLI</a> ·
  <a href="#project-wide-audits">Project-wide audits</a> ·
  <a href="examples/demo-broken">Broken demo</a> ·
  <a href="examples/scenario-lab">Resilience lab</a> ·
  <a href="examples/demo-fixed">Fixed demo</a> ·
  <a href="examples/reference-run/report.html">Visual report</a>
</p>

> [!IMPORTANT]
> RealityCheck is a **v0.4.0 Beta**. It is local-first and conservative: an untested scenario is `unsupported`, never silently “passed.”

## One prompt

After the one-time skill install, this is the complete workflow:

```text
Use $realitycheck on this app. Find the real UI breakages, fix the high-confidence major ones, and prove every fix.
```

No URL is required when the current repository has a discoverable dev command or an already-running local server. RealityCheck will:

1. discover or start the app;
2. open real isolated browser contexts;
3. safely crawl configured routes and stress mobile layout, long content, RTL, failed images, keyboard access, user preferences, and API recovery;
4. save measured DOM evidence and screenshots;
5. fix only the explicitly authorized, high-confidence application causes;
6. rerun the same detector and write a before/after verification.

For a read-only run, say:

```text
Use $realitycheck to audit this app. Do not modify source.
```

### Install the Codex skill once

From this cloned repository:

```bash
python scripts/install-skill.py
```

Reload Codex if its skill list does not refresh automatically. Updating with the same command preserves the previous installed skill as a timestamped backup.

## What makes a finding real?

RealityCheck does not grade a screenshot by “vibes.” A scored finding needs a detector, a stable target, measured behavior, reproduction steps, and evidence. Stress observations are compared with a clean desktop baseline and classified as:

- `existing` — already broken before stress;
- `new` — introduced by the stress condition;
- `worsened` — measurably worse than baseline;
- `resolved` — the same fingerprint stopped reproducing in a successful proving scenario.

Low-confidence observations never reduce the score or fail CI. A skipped, unsupported, or failed proving scenario can only produce `unverified`, not a fake resolution.

## Standalone CLI

Want the browser audit without asking Codex? Install dependencies once, then pass the localhost URL:

```bash
npm install
npm run audit -- http://localhost:3000
```

Requirements: Node.js 20+, Python 3.11+, and an installed Chrome, Edge, or Chromium. RealityCheck pins Playwright Core but does not download a browser.

Useful options:

```bash
npm run audit -- http://localhost:3000 --mode deep --fail-on major
npm run audit -- http://localhost:3000 --compare .realitycheck/runs/BEFORE/report.json
npm run audit -- http://localhost:3000 --baseline .realitycheck/baseline/report.json
npm run audit -- audit --config realitycheck.config.json
```

The second command creates a fresh report plus `verification.json`, bilingual `verification.md`, and a visual `verification.html`. Exit code `1` means the configured quality threshold was met; the reports were still generated successfully.

Initialize and diagnose a project without opening a browser:

```bash
npx realitycheck init
npx realitycheck doctor
```

## Project-wide audits

`realitycheck.config.json` turns a one-page check into a bounded project quality policy. CLI values override config values; paths declared in the config resolve beside that config file.

```json
{
  "$schema": "./node_modules/realitycheck-web-audit/realitycheck/assets/config.schema.json",
  "baseUrl": "http://127.0.0.1:3000/",
  "mode": "quick",
  "failOn": "major",
  "qualityGate": {
    "minimumScore": 90,
    "minimumCoveragePercent": 90,
    "maxWaivedFindings": 2
  },
  "baselinePolicy": {
    "maxAgeDays": 30,
    "requireSamePolicy": true
  },
  "owners": [
    {
      "id": "web-platform",
      "name": "Web Platform",
      "ruleIds": ["custom-primary-navigation-named"],
      "include": ["/app/**"]
    }
  ],
  "crawl": {
    "enabled": true,
    "maxPages": 20,
    "maxDepth": 2,
    "include": ["/app/**"],
    "exclude": ["/logout/**", "/checkout/**"]
  },
  "checks": [
    {
      "id": "primary-navigation-named",
      "selector": "nav",
      "assertion": "accessible-name",
      "severity": "major"
    }
  ],
  "journeys": [
    {
      "id": "settings-notifications",
      "startPath": "/app/settings",
      "severity": "major",
      "steps": [
        { "action": "click", "selector": "[role=tab][aria-controls=notifications]" },
        { "action": "assert", "selector": "#notifications", "assertion": "visible" }
      ]
    }
  ],
  "budgets": {
    "navigationMs": 2500,
    "ttfbMs": 800,
    "firstContentfulPaintMs": 1800,
    "largestContentfulPaintMs": 2500,
    "cumulativeLayoutShift": 0.1,
    "requests": 80,
    "transferKb": 1500,
    "domNodes": 1800,
    "severity": "major"
  },
  "security": {
    "requiredHeaders": ["content-security-policy", "x-content-type-options", "referrer-policy"],
    "secureForms": true,
    "maxThirdPartyOrigins": 3,
    "allowedThirdPartyOrigins": ["https://cdn.example.com"],
    "severity": "major"
  },
  "waivers": [
    {
      "id": "legacy-toolbar-web-42",
      "ruleId": "custom-toolbar-minimum-size",
      "reason": "Replacement is tracked in WEB-42",
      "owner": "Web Platform",
      "expires": "2027-01-31",
      "include": ["/app/legacy/**"]
    }
  ]
}
```

The crawler only follows same-origin page links, strips query strings and fragments, never clicks controls or submits forms, and rejects common logout, purchase, delete, and OAuth routes by default. Each page runs in isolated browser contexts. One page failure does not erase evidence from the others.

Custom checks are declarative—`exists`, `visible`, `enabled`, `accessible-name`, `attribute`, `count`, `no-horizontal-overflow`, or `minimum-size`—and may be restricted by route globs. Declarative journeys reuse these assertions across safe same-origin navigation, tabs, and disclosures; every step gets a checkpoint screenshot. The runner refuses form submission, destructive labels, excluded routes, ambiguous click selectors, and unmarked business buttons. Arbitrary JavaScript is deliberately rejected. See the passing and failing [`examples/journey-lab`](examples/journey-lab) configurations.

Security baselines are opt-in project policy, so a localhost page is not judged against production headers unless the project asks for them. Policies can require reviewed response headers, forbid mixed content, reject insecure password-form paths, cap unique third-party origins, and allowlist exact HTTPS origins. The [`examples/security-lab`](examples/security-lab) fixture demonstrates three missing headers plus a GET password form without ever submitting it.

Performance budgets now include TTFB, First Contentful Paint, Largest Contentful Paint, and Cumulative Layout Shift in addition to navigation, DOMContentLoaded, request, transfer, and DOM limits. Authenticated apps can load a Playwright storage-state file with `--storage-state` or `REALITYCHECK_STORAGE_STATE`; the path, cookies, tokens, and values are never copied into reports.

Governed waivers support real-world known debt without hiding it. A waiver requires an exact rule, reason, and expiry; it may also name an owner, selector, and route scope. The report still shows the finding, screenshots, remediation, and waiver metadata, while score and gate ignore it until expiry. `doctor` fails on expired policy, SARIF records an external suppression, and JUnit keeps the evidence without failing the scenario.

Release policies go beyond a severity cutoff. `qualityGate` can require a minimum deterministic score, a minimum percentage of successfully completed scenarios, and a maximum number of active waivers. Every failed condition is recorded in JSON, printed by the CLI, and explained in English and Chinese in the page report. Strict comparison and regression-only baseline flows preserve these policy limits, so entering a verification workflow cannot bypass them. The `policy.config.json` fixture intentionally uses `failOn: "never"` but still fails at **96/100** against a required score of **100**.

Finding ownership turns evidence into accountable work without guessing from page text. An `owners` entry can match exact rule IDs and route globs. Exactly one match adds a stable team ID and display name to the page/site report, comparison, repair plan, and evidence catalog; overlapping matches stay unassigned and produce a warning so ambiguous policy cannot silently route work to the wrong team. This is separate from a waiver owner: ownership answers who should act, while a waiver documents who accepted a temporary exception.

Regression baselines can expire too. `baselinePolicy.maxAgeDays` limits how long `--baseline` may preserve known debt, while `requireSamePolicy` prevents deleted custom checks, changed budgets, scenario-mode changes, or detector-version drift from masquerading as fixes. Every standalone audit records a SHA-256 fingerprint of its non-secret detector policy. RealityCheck still writes the complete page/site verification, then adds machine-readable `baseline-age` or `policy-drift` violations. These policies apply only to regression-gated baselines; an explicit `--compare` remains available for historical analysis. Age uses run timestamps, not filesystem timestamps.

The synthetic [`examples/authenticated-app`](examples/authenticated-app) fixture proves this boundary end to end: the anonymous run fails its declared admin-panel rule at 96/100, while the same page loaded with generated loopback-only state passes at 100/100. CI asserts that neither the state path nor its synthetic value appears in `report.json`.

The paired [`examples/accessibility-lab`](examples/accessibility-lab) fixture exercises conservative baseline checks in Quick mode. Its negative page produces five measured findings—missing language, missing title, duplicate IDs, a skipped heading level, and an unnamed icon control—at **93/100**. Deep mode also runs bundled axe-core 4.12.1 and records WCAG A/AA plus best-practice violations with at most five sampled nodes per rule. These checks improve coverage but do not claim WCAG conformance.

The [`examples/waiver-lab`](examples/waiver-lab) fixture makes governance directly demonstrable. Audit with `unwaived.config.json` and the missing declared export control scores **96/100** and fails the Major gate. Audit with `realitycheck.config.json` and the same finding remains fully visible, but the named waiver yields **100/100** and a passing gate. The report exposes its owner, reason, and expiry instead of pretending the defect disappeared.

A multi-page run adds `site-report.json`, `site-report.md`, and a bilingual `site-report.html` dashboard. Use a previous `site-report.json` with `--baseline` to allow known debt while failing only new, worsened, or unverified regressions across the site.

## Default scenarios

| Scenario | Quick | What it proves |
| --- | :---: | --- |
| Baseline | Yes | Runtime/resource defects, semantics, custom rules, Core Web Vital budgets, and configured security policy |
| 375px mobile | Yes | Offscreen actions, fixed widths, and document overflow |
| Long text | Yes | New or worsened clipping under CJK, emoji, and unbroken strings |
| RTL Arabic | Yes | Physical-direction CSS and alignment assumptions |
| Image failure | Yes | Missing alternatives and media-failure resilience |
| Keyboard Tab | Yes | Focus reachability and obvious focus failures without activation |
| Reduced motion | Deep | Persistent non-progress animation under the user's reduced-motion preference |
| Dark scheme | Deep | Declared dark-theme text contrast using computed foreground/background samples |
| Slow API | Deep | Loading recovery under bounded same-origin request delay |
| API error | Deep | Visible recovery feedback after bounded same-origin GET requests return 503 |
| Empty data | Deep | Empty-state behavior after a safe JSON-array transform |
| 200% page zoom | Deep | Runs only when the adapter exposes real page zoom |
| axe-core | Deep | Bundled WCAG A/AA and best-practice rules, capped at five evidence nodes per rule |

Quick mode targets a useful first result in under a minute for a small stable page. Every scenario has an explicit terminal status, including unsupported and skipped coverage.

## The report is actionable

Each run stays in the target repository:

```text
.realitycheck/runs/<run-id>/
├── audit-input.json
├── report.json
├── report.md
├── report.html
├── report.sarif
├── report.junit.xml
├── repair-plan.json
├── repair-plan.md
├── evidence-manifest.json
└── screenshots/
```

The output root also contains stable `latest.json` and bilingual `latest.html` pointers. They update only after a complete page or site report (and requested comparison) has been written, then link to the timestamped artifacts with portable relative paths. Historical runs are never overwritten, while dashboards and bookmarks no longer need to predict a run ID. A gate-failing but fully rendered audit becomes the latest evidence; an interrupted half-run does not.

`evidence-manifest.json` records every file in the completed run with its portable path, byte count, media type, and SHA-256 digest. `realitycheck validate` recalculates those digests, so a missing, truncated, or modified report/screenshot fails validation instead of looking like untouched evidence. Before signing, the optional `attest` command performs that same full-bundle integrity check and refuses an internally inconsistent manifest; it then signs the exact manifest bytes with an Ed25519 key and writes schema-validated `evidence-attestation.json` plus a bilingual HTML receipt. Signature validity proves possession of the corresponding private key; trust the signer only after matching the embedded key ID against an independently controlled allowlist or registry.

```bash
openssl genpkey -algorithm Ed25519 -out ci-ed25519.pem
npx realitycheck attest .realitycheck/runs/RUN/evidence-manifest.json \
  --private-key ci-ed25519.pem
npx realitycheck validate .realitycheck/runs/RUN/evidence-attestation.json
```

To turn signature validity into an organizational trust decision, require one or more independently distributed key IDs:

```bash
npx realitycheck validate .realitycheck/runs/RUN \
  --require-attestation \
  --trusted-key sha256:YOUR_64_HEX_PUBLIC_KEY_ID
```

For durable CI governance, copy [`examples/evidence-trust.example.json`](examples/evidence-trust.example.json), replace its placeholder ID, and version the policy separately from the signing Secret. It can name trusted or revoked keys, bound their validity windows, and require every discovered manifest to carry a signature:

```bash
npx realitycheck validate .realitycheck/runs/RUN \
  --trust-policy evidence-trust.json

npx realitycheck trust-report .realitycheck/runs/RUN/evidence-manifest.json \
  --trust-policy evidence-trust.json
```

`trust-report` writes schema- and semantics-validated `evidence-trust-report.json` and a self-contained bilingual HTML decision. It records the exact trust-policy digest and evaluates evidence-file integrity, Ed25519 signature validity, and signer authorization independently, so a valid signature from an unapproved key is shown as an authorization failure rather than mislabeled as corruption. Internal state/check/error consistency is revalidated to catch simple decision tampering. During an emergency full-key revocation it still emits a durable `REJECTED` decision with `activeKeys: 0` and explicit reasons, while `validate` and `attest` continue to fail closed because no key is authorized. A decision for the current run is also linked from stable `latest.json/html`; historical decisions cannot move that pointer.

Keep the private key out of source control. When the signed run is also the output root's current run, `attest` refreshes `latest.json/html` only after the receipt passes cryptographic and configured signer-authorization checks; a rejected receipt remains available for diagnosis but cannot pollute the stable pointer. Signing older history never changes that pointer. The composite GitHub Action accepts `attestation-private-key: ${{ secrets.REALITYCHECK_ED25519_PRIVATE_KEY }}`, writes it only to a permission-restricted runner temp file, deletes that file after signing, exposes `attestation-count`, and includes signed receipts in the uploaded evidence catalog. Set `attestation-trusted-key-id` from a separately controlled repository variable to make the job fail if the Secret unexpectedly resolves to another public key. Set `trust-policy` to a checked-in registry path to generate a decision for every manifest, expose `trust-report-count` / `trust-exit-code`, and enforce rejected evidence only after reports are cataloged and uploaded.

A comparison adds `verification.json`, bilingual `verification.md`, and a self-contained bilingual `verification.html` dashboard. Each page render also emits a schema-validated repair handoff in JSON and Markdown with stable fingerprints, proving scenarios, remediation, and acceptance conditions. Project-wide runs add a site dashboard; trend aggregation adds `trend.json`, `trend.md`, and bilingual `trend.html`. The artifact catalog indexes all of those outputs into one searchable bilingual page, without a database or hosted service.

The self-contained HTML report works offline, switches between English and Chinese, and loads no remote assets. Every active finding includes **Copy fix + verification task**. Reviewers can also filter findings, select the visible subset, and copy one batch repair plan containing only stable finding IDs and proving scenarios. These actions prepare bounded Codex tasks; they cannot silently edit source from a static report.

Open the committed [visual reference report](examples/reference-run/report.html) or its [Markdown version](examples/reference-run/report.md). They demonstrate the renderer and CI contract; generate a fresh run before treating measurements as evidence about another app.

## Try the intentionally broken demo

Terminal 1:

```bash
python -m http.server 4173 --bind 127.0.0.1 --directory examples/demo-broken
```

Terminal 2:

```bash
npm run audit -- http://127.0.0.1:4173 --fail-on never
```

The demo deliberately contains a fixed-width shell, mobile-only loss of access, long-text clipping, a missing image alternative, a console error, weak focus visibility, and an empty-data failure. A typical local run completes the six Quick scenarios in seconds and produces real screenshots.

[`examples/demo-fixed`](examples/demo-fixed) contains the corresponding application-level repairs. CI serves the broken and fixed fixtures at the same URL, runs two fresh real-browser audits, and fails unless the before findings stop reproducing without new or unverified findings. On the local proof run used during v0.2 development, the score moved from **69 to 100**, with **7 resolved, 0 remaining, 0 new, and 0 unverified**.

### Try the Deep resilience laboratory

Serve the repository root, then audit the paired fixture pages:

```bash
python -m http.server 4175 --bind 127.0.0.1 --directory .
npm run audit -- http://127.0.0.1:4175/examples/scenario-lab/broken.html --mode deep --fail-on never
npm run audit -- http://127.0.0.1:4175/examples/scenario-lab/fixed.html --mode deep --fail-on major
```

The negative fixture deterministically exposes persistent motion, low dark-theme contrast, missing 503 recovery feedback, and a missing empty state. The positive fixture fixes the same four conditions. The v0.3 local proof scored **86/100 with four findings** versus **100/100 with none**.

## Safety boundaries

- Localhost, loopback, and private targets are allowed by default; public targets require explicit authorization.
- The audit never clicks purchase, delete, publish, send, login, consent, or submit actions.
- Reports redact sensitive keys, query parameters, bearer tokens, and JWT-like strings.
- Network stress is bounded to safe same-origin requests in fresh contexts.
- Audit mode is read-only. Source changes require an explicit fix/harden request.
- No cloud service, telemetry, hidden model call, or hidden browser download.

Use RealityCheck only on applications you own or are authorized to test.

## CI and report tooling

The Python renderer has no third-party runtime dependency. Every render emits HTML, Markdown, JSON, SARIF 2.1.0, and JUnit XML:

```bash
python realitycheck/scripts/report.py validate \
  .realitycheck/runs/<run-id>/report.json \
  --fail-on major

python realitycheck/scripts/report.py compare \
  .realitycheck/runs/<before>/report.json \
  .realitycheck/runs/<after>/report.json \
  --fail-on major

python realitycheck/scripts/report.py trend .realitycheck/runs \
  --output .realitycheck/trends

npx realitycheck validate .realitycheck/runs

npx realitycheck catalog .realitycheck/runs \
  --output .realitycheck/catalog

npx realitycheck risk-register .realitycheck/runs \
  --output .realitycheck/risks \
  --max-open-age-days 30 \
  --max-open-risks 20 \
  --max-recurring-risks 10
```

`validate` uses a standards-compliant JSON Schema validator and recursively checks project configs, page reports, repair plans, page verification, site reports, site verification, trends, catalogs, latest pointers, integrity manifests, Ed25519 attestations, evidence trust policies, and risk registers. `--require-attestation` makes every discovered manifest require a sibling signature and automatically validates it; combine this with one or more `--trusted-key` values or use `--trust-policy` for an archive-level trust gate with revocation and validity windows. `catalog` validates every discovered source artifact, includes signed receipts, skips incompatible historical files with visible warnings, and writes a searchable artifact inventory. `risk-register` groups page findings by exact target and stable fingerprint, records first/last seen and recurrence, exposes dedicated recurring and overdue filters, and uses the newest proving scenario plus available policy fingerprints to distinguish open, waived, resolved, and unverified risk. Optional open-count, age, and recurrence limits turn the ledger into a portfolio quality gate: the JSON/HTML/Markdown outputs are still written, while exit code `1` tells CI that the debt policy failed. Scenario gaps or policy drift remain explicitly unverified. It also emits formula-injection-safe CSV. Their contracts are published in [`realitycheck/assets`](realitycheck/assets).

This repository is also a reusable composite GitHub Action. It always attempts to build both the artifact catalog and longitudinal risk register, adds their Markdown summaries to the GitHub job summary, exposes catalog/risk/trust paths and exit codes, and uploads the complete evidence bundle before enforcing page/site quality, optional portfolio-risk gates, or evidence-trust decisions. Configure `max-open-risk-age-days`, `max-open-risks`, and `max-recurring-risks` to make longitudinal debt part of the job result. See [`examples/github-actions/quality-gate.yml`](examples/github-actions/quality-gate.yml) for a regression-only baseline gate.

## Project status

RealityCheck is Codex-first, but its standalone audit CLI and report tools also work directly in a cloned repository. Real 200% browser zoom remains adapter-dependent and is disclosed as unsupported by the bundled CLI; axe-core is bundled and executed in Deep mode.

See [ROADMAP.md](ROADMAP.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md). The project is licensed under [MIT](LICENSE).
