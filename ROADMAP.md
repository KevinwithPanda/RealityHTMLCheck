# Roadmap

RealityCheck prioritizes trustworthy evidence over scenario count. Dates are intentionally omitted until maintainers can support them.

## v0.1 - Beta foundation

- [x] Codex-first installable skill.
- [x] Quick and deep audit protocols.
- [x] Audit-only default and explicitly scoped fix workflow.
- [x] Baseline-aware classifications and deterministic scoring.
- [x] Responsive HTML, Markdown, and JSON reports with redaction.
- [x] English/Chinese visual report localization without changing machine enums.
- [x] Finding-scoped fix-instruction actions with explicit authorization boundaries.
- [x] CI threshold validation.
- [x] Broken demo and reference report fixture.
- [x] Local/private target safety policy.

## v0.2 - Reproducible headless adapter

- [x] Ship a pinned, optional Playwright Core adapter that reuses an installed system browser.
- [x] Add a one-command audit CLI with local/private target defaults.
- [x] Add stable before/after comparison with an explicit unverified state.
- [x] Add a recoverable one-command Codex skill installer.
- [x] Produce real screenshots for the broken and fixed browser fixtures in CI.
- [x] Implement bounded network delay and safe empty-array scenarios in the standalone adapter.
- [x] Add dedicated positive and negative recovery fixtures to CI.
- [x] Validate the published JSON Schema with a standards-compliant validator.
- [x] Add a reusable GitHub Actions workflow that generates and gates reports.
- [ ] Add Windows, macOS, and Linux adapter coverage.

## v0.3 - Better comparison and portability

- [x] Compare report runs across commits.
- [x] Add a static HTML view without external runtime dependencies.
- [ ] Define a browser-adapter conformance suite.
- [ ] Test and document one non-Codex agent adapter.
- [x] Add user-defined critical controls and safe declarative checks.
- [x] Add auditable, expiring known-risk waivers that preserve evidence while temporarily excluding findings from score and gates.
- [x] Add a local evidence catalog across page, site, verification, and trend artifacts, including CI job summaries.
- [x] Add explainable numeric release policies that cannot be bypassed by baseline comparison.
- [x] Add deterministic rule-and-route ownership carried from findings into evidence, repair handoff, and catalog search.
- [x] Add stable, schema-validated latest-run entry points without sacrificing immutable timestamped history.
- [x] Add per-run SHA-256 evidence manifests and semantic integrity validation for local/CI archives.
- [x] Add optional Ed25519 publisher-key attestations, trust-aware validation, catalog discovery, and CI Secret handling.
- [x] Add archive-level required-signature validation with signer-key allowlists.
- [x] Add versionable signer trust registries with revocation and key-validity windows.
- [x] Add human-readable archive trust decisions with independent integrity, signature, and authorization results.
- [x] Add longitudinal portfolio gates for excessive open count, overdue open risks, and excessive recurring risk.
- [x] Add a longitudinal, owner-aware risk register with conservative resolution evidence and CI/CSV handoff.
- [x] Add explicit regression-baseline freshness policy for page and site release gates.
- [x] Prevent false resolutions by fingerprinting detector policy and gating regression baselines on policy drift.

## v0.4 - Product workflows and public proof

- [x] Add safe declarative user journeys with per-step evidence and non-submission guards.
- [x] Extend safe journeys with navigation-only keyboard input and query-free path assertions.
- [x] Bundle axe-core for bounded WCAG A/AA and best-practice evidence in Deep mode.
- [x] Add explicit response, form, and third-party-origin security policy.
- [x] Add Core Web Vital budgets captured from pre-navigation observers.
- [x] Add API/all-resource reliability budgets for HTTP errors, transport failures, latency, and third-party request volume.
- [x] Add route-level link-integrity auditing with HEAD-only safety boundaries and redirect-chain evidence.
- [x] Publish a bilingual Pages site with real Chrome evidence packs and live failing fixtures.
- [x] Add visual-regression baselines with explicit update approval and bounded pixel-difference evidence.
- [x] Add shareable validated policy presets for starter, product, and strict release adoption.
- [x] Add explicit publishing metadata contracts with privacy-bounded evidence and paired release fixtures.
- [x] Add a one-command bundled real-browser demo that needs no application server or project config.

## v1.0 criteria

- Stable report and adapter contracts.
- End-to-end fixture evidence on every supported platform.
- Bounded false-positive review for all default detectors.
- Upgrade and compatibility policy.
- Security review of browser mutations, evidence storage, and CI use.

## Good first issues

- Add a positive RTL fixture that must not produce a finding.
- Add a responsive version of the broken demo for detector regression comparison.
- Improve Markdown rendering for screenshot galleries.
- Add JSON Schema tests for example reports.
- Document integration with an existing Playwright project.

Open a scenario proposal before adding a default test. Every new default scenario needs a safety boundary, capability probe, positive fixture, negative fixture, evidence rule, and runtime budget.
