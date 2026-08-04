# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

## [Unreleased]

### Added

- A browser-free `plan` command that resolves effective project coverage into a schema-validated, fingerprint-bound, bilingual HTML/JSON/Markdown preview with page/scenario ceilings, all detector states, explicit safety and retention boundaries, a copy-ready next command, and a committed 301-execution demonstration. The composite Action now publishes this fail-closed preflight before browser access, and the evidence catalog indexes it alongside run evidence.
- Opt-in semantic response-header policies for bounded CSP directive/source-token rules, HSTS transport/max-age/subdomain/preload facts, exact `nosniff`, reviewed Referrer-Policy enums, and empty-allowlist requirements for 15 controlled Permissions-Policy features. Raw header values, allowed origins, CSP nonces/hashes, and unknown tokens are discarded; policy-review treats lost or relaxed requirements as structural weakening.

- Search-friendly JSON-LD, a Web manifest, crawler and LLM entry points, visible CI status, and explicit support/community policies without third-party runtime analytics.
- Opt-in API/all-resource network reliability budgets for HTTP errors, transport failures, slow requests, and third-party request volume, with bounded query-free endpoint samples and no response-body retention.
- Passing/failing network fixtures plus committed real-browser evidence proving a missing API fails at 96/100 while the restored endpoint passes at 100/100.
- HEAD-only same-origin link integrity budgets with bounded concurrency/redirects/timeouts, dangerous-route exclusions, query-free failure samples, and paired 96/100 versus 100/100 fixtures.
- A bilingual GitHub Pages product site that now publishes eleven immutable real-browser evidence packs, live fixtures, repair actions, and a SHA-256-verifiable reference report.
- Validated `starter`, `product`, and `strict` project profiles, with secret-safe `init --profile ... --base-url ...` generation and a bilingual profile catalog.
- Safe journey `press` and `assert-url` steps for keyboard navigation and pathname checkpoints, with activation-key/editable-control guards and query-free traces.
- Opt-in publishing metadata contracts for title and description length, canonical destinations, viewport, language, indexing, and primary-heading structure, with paired 75/100 versus 100/100 real-browser evidence.
- Pathname-keyed visual regression baselines with bounded pixel thresholds, declarative dynamic-region masks, SHA-256 approval indexes, explicit first approval and replacement commands, and self-contained current/approved/diff evidence.
- A zero-configuration `demo` command with a finite read-only loopback server, bundled broken fixture, automatic teardown, real-browser evidence, and an expected-failure success contract for first-run evaluation.
- Latest-target GitHub job summaries and bounded Error/Warning/Notice workflow annotations with bilingual output, query removal, waiver handling, stale-run suppression, and hostile command-text neutralization.
- A bounded one-to-six responsive viewport matrix with isolated contexts, per-breakpoint screenshots and attribution, profile-specific phone/tablet coverage, policy fingerprinting, and paired 92/100 versus 100/100 real-browser fixtures.
- A schema-validated `policy-review` anti-weakening gate with conservative structural classification, safe metadata-only evidence, bilingual Markdown/HTML, GitHub Action inputs/outputs, and a 48-change governance fixture.
- Opt-in aggregate Cookie, third-party Cookie, localStorage, and sessionStorage privacy budgets with UTF-8 byte/entry limits, fail-closed measurement handling, zero key/value retention, policy fingerprinting, anti-weakening review, paired 76/100 versus 100/100 fixtures, and committed real-browser evidence.
- Review-first GitHub issue draft bundles that deduplicate stable fingerprints, preserve every evidence occurrence and acceptance condition, remove query values, neutralize mentions, and export schema-validated JSON, bilingual Markdown/HTML, and CSV without submitting anything externally.
- A conservative `release-decision` command and Action output that selects fresh validated audit, verification, policy, trust, risk, and repair-review controls; binds sources by SHA-256; preserves distinct GO/REVIEW/NO-GO exits; and never deploys or approves a release.

### Changed

- Detector policy fingerprints and `doctor` output now include network reliability and link-integrity policy so removing an API or navigation gate cannot masquerade as a verified fix.
- Generated Markdown metadata uses explicit lists instead of invisible hard-break whitespace, keeping repository quality checks clean across editors and GitHub.
- Switching report language now regenerates any visible individual or batch repair task and clears stale-language copy feedback.
- Failed journey assertions now keep one measured trace record instead of adding a second duplicate failure entry.
- Public detector evidence retains metadata counts, lengths, directives, and query-free canonical structure instead of title or description copy.
- Visual baselines can no longer change as a side effect of auditing; an existing different baseline requires `visual-approve --replace-baseline`, while ordinary audits remain read-only.
- Quick scenario counts and progress now adapt to the configured viewport matrix while preserving the original 375x812 default.
- The composite Action uploads and summarizes optional policy-change evidence before enforcing its gate, alongside page, portfolio-risk, and trust decisions.
- The composite Action now produces a local issue-draft board before cataloging and uploads it with the evidence bundle through the `issue-drafts-path` output.
- The composite Action now builds the longitudinal risk register before a freshness-aware release decision, adds the bilingual decision to the job summary, catalogs it, uploads all evidence, and exposes decision/path/exit outputs.

## [0.4.0] - 2026-08-05

### Added

- Safe declarative user journeys with same-origin navigation, bounded state assertions, per-step screenshots, and guards that refuse form submission and destructive actions.
- Explicit security baselines for required response headers, mixed content, sensitive forms, third-party origin budgets, and reviewed HTTPS-origin allowlists.
- Real Deep-mode axe-core 4.12.1 scanning for WCAG A/AA and best-practice rules, capped at five evidence nodes per rule and clearly bounded short of a WCAG conformance claim.
- Browser-measured TTFB, First Contentful Paint, Largest Contentful Paint, and Cumulative Layout Shift budgets alongside existing navigation, request, transfer, and DOM budgets.
- Passing/failing journey fixtures and an intentional security-policy laboratory with ready-to-run project configurations.

### Changed

- Detector policy fingerprints now cover journeys and security baselines, preventing removed workflow or security checks from masquerading as verified fixes.
- `doctor` reports bundled accessibility-engine availability and summarizes configured journeys, security baselines, and expanded performance budgets.

### Governance

- An open-risk count budget (`--max-open-risks` and matching composite-Action input) alongside age and recurrence portfolio gates.
- `doctor` visibility for Ed25519 support, bundled trust-registry contracts, and all three portfolio-risk budgets.

### Security

- Attestation creation now recomputes every evidence-file digest before signing, revalidates the manifest and receipt before publication, and updates stable `latest` pointers only after configured signer authorization succeeds.
- Trust decisions now preserve a schema-valid, explained `REJECTED` artifact when every registry key is emergency-revoked or a present attestation is malformed; validation and signing remain fail-closed.
- Risk-register validation now recomputes state, recurrence, overdue, summary, configured-limit, and violation semantics so a contradictory archived gate cannot pass by changing only decision fields.

## [0.3.0] - 2026-08-01

### Added

- Auto-discovered `realitycheck.config.json`, `init`, and `doctor` workflows with CLI-over-config precedence and config-relative paths.
- Bounded same-origin route discovery with include/exclude globs, dangerous-path defaults, per-page isolation, failure continuation, and bilingual site dashboards.
- Optional authenticated Playwright storage state whose path and secret values are excluded from every artifact.
- Route-scoped declarative custom checks for existence, visibility, enabled state, accessible names, attributes, counts, overflow, and minimum size without arbitrary script execution.
- Browser-measured performance budgets for navigation, DOMContentLoaded, request count, transfer size, and DOM size.
- Deep reduced-motion, declared dark-scheme contrast, and synthetic API 503 recovery scenarios, bringing the standalone adapter to 13 explicit scenarios.
- Positive and negative resilience fixtures that prove motion, dark-theme, API recovery, and empty-state detectors in real Chrome runs.
- Project-wide baseline comparison with resolved, remaining, worsened, new, unverified, failed-page, added-page, and removed-page states.
- Longitudinal bilingual quality-trend dashboards grouped by exact target URL.
- SARIF 2.1.0 and JUnit XML outputs for every page render.
- Published schemas for page verification, site reports, site verification, and trends plus a standards-compliant recursive `realitycheck validate` command.
- Reusable composite GitHub Action that preserves quality-gate exit codes and always uploads evidence.
- Governed finding waivers with mandatory reasons and expiry, optional owners/selectors/routes, visible evidence, automatic expiry, SARIF suppressions, and JUnit-aware gate semantics.
- A schema-validated bilingual artifact catalog that indexes page/site audits, repair proofs, and trends with search, status/type filters, portable links, and responsive offline rendering.
- GitHub Action catalog generation, `catalog-path` output, and an always-available job summary alongside uploaded evidence.
- Explainable release policy gates for minimum score, minimum completed-scenario coverage, and maximum active waivers, preserved across page/site reports and strict or regression-only verification.
- Multi-select batch repair plans in bilingual HTML reports, scoped to stable finding IDs and proving scenarios with the same explicit source-edit authorization boundary as single-finding actions.
- Schema-validated JSON and Markdown repair handoff artifacts for downstream agents, tickets, and review workflows, indexed alongside evidence in the artifact catalog.
- Deterministic rule-and-route finding ownership that propagates accountable team IDs and names through page/site evidence, comparisons, repair plans, and catalog search while rejecting ambiguous routing.
- Schema-validated `latest.json` and bilingual `latest.html` stable pointers for the newest complete page/site workflow, with portable report, repair-plan, and verification links that never overwrite timestamped history.
- SHA-256 evidence manifests across report, repair, verification, screenshot, and site artifacts, with semantic validation that detects missing, truncated, or modified files.
- Optional Ed25519 evidence attestations with embedded public keys and stable key IDs, semantic signature verification, bilingual receipts, catalog discovery, and GitHub Action Secret integration.
- Safe latest-run attestation linking: signing the current run refreshes stable JSON/HTML receipt actions, while historical signatures never replace the latest pointer.
- Archive trust enforcement with repeatable trusted-key allowlists and `--require-attestation`, which automatically discovers signatures beside manifests and fails unsigned, untrusted, or cryptographically invalid evidence.
- Versionable `evidence-trust.json` registries with named trusted/revoked keys, UTC validity windows, required-signature policy, schema validation, and conservative duplicate/empty-active-key rejection.
- Schema-validated bilingual evidence trust decisions that independently expose integrity, signature, and authorization checks, preserve rejected reasons, and appear as pass/fail items in the artifact catalog.
- Trust-decision policy digests and semantic state/check/error consistency validation to detect simple decision-field tampering.
- Stable latest-run links for current trust decisions, with historical decision generation unable to replace the latest pointer.
- Composite GitHub Action trust-policy evaluation across every manifest, with decision counts/status outputs and deferred enforcement after cataloging and evidence upload.
- Longitudinal risk registers that deduplicate stable fingerprints across runs, surface a recurring-risk metric and filter, conservatively classify open/waived/resolved/unverified state, preserve accountable owners, and export bilingual HTML, Markdown, JSON, and formula-safe CSV; GitHub Actions publishes the register in job summaries and artifacts.
- Portfolio risk gates for maximum open-risk count, open-risk age, and recurring-risk count, with overdue marking/filtering, machine-readable violations, bilingual failure disclosure, and CI exit code `1` while preserving the ledger.
- Composite GitHub Action inputs and a dedicated `risk-exit-code` output for enforcing longitudinal portfolio policy only after evidence cataloging, job-summary publication, and artifact upload.
- Expiring regression baselines with page/site `baseline-age` gate violations, bilingual explanations, and timestamp-based age evidence that cannot be refreshed by copying files.
- Canonical SHA-256 detector-policy fingerprints and optional page/site `policy-drift` gates, preventing removed checks, changed budgets, mode changes, or detector-version drift from being reported as successful repairs.
- Self-contained page/site verification provenance with before/after timestamps, modes, tool versions, and optional policy fingerprints while retaining v0.2 reader compatibility.

### Changed

- Visual reports now support bilingual severity filters, text search, live result counts, and responsive mobile toolbars.
- Strict comparison now gates unverified serious findings; regression-only baselines gate new, worsened, and unverified findings while allowing known debt to remain visible.
- Baseline checks now detect unnamed interactive controls, missing document language/title, duplicate IDs, and heading-level skips; mobile checks flag severe sub-24px interactive targets.
- Site and trend links are portable relative paths to visual HTML evidence.

### Known limitations

- Real 200% page zoom and bundled axe-core remain explicitly unsupported in the standalone adapter.
- Dark-theme contrast is a bounded computed-color approximation; transparency, gradients, and image backgrounds still need human visual review.
- Cross-platform system-browser execution is configured in CI but still needs a completed Windows/macOS/Linux matrix.

## [0.2.0] - 2026-08-01

### Added

- One-command standalone audit CLI backed by pinned Playwright Core and an already-installed Chrome, Edge, or Chromium browser.
- Real browser execution for Baseline, 375px mobile, long text, RTL, image failure, and keyboard focus scenarios.
- Bounded Deep checks for slow same-origin APIs and safe top-level empty-array responses.
- Stable cross-run finding fingerprints and `compare` output with resolved, remaining, new, and unverified states.
- One-command cross-platform Codex skill installer with recoverable updates.
- Self-contained responsive `report.html` output with score, scenario, finding, evidence, and print views.
- English/Chinese report switching with localized finding, scenario, remediation, and warning content.
- Finding-scoped fix-and-verification tasks that preserve the explicit source-edit authorization boundary.
- HTML renderer regression coverage for escaping, redaction, offline assets, localization, scoped repair actions, comparison, and deterministic reference output.

### Changed

- A URL is no longer required in the Codex prompt when the current app can be discovered or started from repository metadata.
- Runtime errors are grouped per detector to avoid duplicate finding IDs.
- The homepage now leads with the complete value proposition and a one-prompt workflow.

### Known limitations

- The standalone Deep adapter reports real page zoom and axe-core as unsupported unless another selected adapter provides them.
- System-browser integration still needs automated Windows, macOS, and Linux CI coverage.

## [0.1.0] - 2026-08-01

### Added

- `$realitycheck` Codex skill with `audit` and explicitly scoped `fix` workflows.
- Quick and deep browser stress-test protocols.
- Codex-browser and project-Playwright adapter selection rules.
- Local/private target policy and explicit remote authorization boundary.
- Dependency-free report initializer, sanitizer, scorer, Markdown renderer, validator, and CI threshold gate.
- Versioned JSON report schema.
- Intentionally broken zero-dependency Web demo.
- Deterministic reference report fixture.
- English and Chinese documentation, visual identity, roadmap, security policy, and contribution templates.

### Known limitations

- Interactive Codex browser availability depends on the host Codex environment.
- The project-Playwright adapter currently follows a protocol rather than shipping a standalone headless audit package.
- CI validates existing reports; fully headless audit generation is planned for v0.2.
- Other coding agents are not yet advertised as supported.
