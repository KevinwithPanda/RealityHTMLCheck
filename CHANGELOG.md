# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

## [Unreleased]

### Added

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
