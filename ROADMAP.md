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
- [x] Add privacy-preserving semantic CSP, HSTS, nosniff, Referrer-Policy, and Permissions-Policy release rules.
- [x] Add privacy-bounded cross-origin script/stylesheet Subresource Integrity release rules.
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
- [x] Add latest-target GitHub job summaries and bounded, injection-safe workflow annotations.
- [x] Replace the single fixed mobile checkpoint with a bounded, policy-fingerprinted responsive viewport matrix and paired real-browser fixtures.
- [x] Add a schema-validated structural policy anti-weakening review with bilingual GitHub Action evidence.
- [x] Turn repair plans into deduplicated, bilingual GitHub issue drafts with safe local copy/export and no automatic external submission.
- [x] Add a freshness-aware, SHA-256-bound GO/REVIEW/NO-GO release decision over audit, verification, policy, trust, risk, and repair-review evidence.
- [x] Add aggregate browser-storage privacy budgets with zero key/value retention, explicit measurement failures, policy anti-weakening coverage, and paired public real-browser proof.
- [x] Add a browser-free, bilingual effective audit-plan preview with schema validation, semantic binding, safety/data-retention disclosure, and a public demonstration.

## v0.5 - HTML note adoption loop

- [x] Make folder readiness depend on the lowest HTML file instead of an average that can hide one broken note.
- [x] Follow reachable HTML → CSS → `@import` → asset dependencies and verify cross-note fragments with path-case and package-boundary checks.
- [x] Export a self-contained bilingual share report with a conservative sharing decision.
- [x] Run the installed Codex Skill's note workflow without repository dependencies and keep end-to-end repair inside one task.
- [x] Add a browser-free HTML note GitHub Action with bounded annotations, canonical artifact paths, an uploaded report, and error/warning gates.
- [x] Prove the packed `realityhtmlcheck` CLI through an isolated npx-style consumer and add a guarded checksum/OIDC release workflow.
- [x] Publish hashed representative export structures and before/after decision cases with an explicit non-certification boundary.
- [x] Freeze and byte-for-byte reproduce one actual Pandoc 3.8.2.1 HTML export with command, hashes, privacy, and license provenance.
- [x] Add a privacy-safe intake path for community-contributed, versioned real export samples.
- [x] Add fail-closed note baseline comparison with new/resolved/worsened/persistent/unverified states and regression-only Action gates.
- [ ] Bootstrap the public npm package and bind `release.yml` to npm trusted publishing.
- [ ] Collect at least 20 licensed, de-identified real export samples across multiple tool versions and platforms.
- [ ] Publish a separate real-export compatibility matrix with static results plus bounded browser visual/interaction evidence.

## v0.6 - Regression and provenance credibility

- [x] Separate package findings from per-HTML findings and prevent score double counting.
- [x] Compare immutable note baselines without keeping persistent known debt permanently red.
- [x] Fail closed when HTML/package scope disappears, contracts, or becomes newly excluded.
- [x] Expand actual Pandoc evidence to four allowlisted, byte-reproducible export shapes.
- [x] Serialize stable latest aliases across concurrent note processes.

## v0.7 - Repair proof and archive scope

- [x] Recheck the exact in-memory safe-repair bytes before a single HTML download.
- [x] Show resolved, remaining, introduced, original-folder, and HTML-only evidence separately.
- [x] Add auditable archive/draft exclusions that preserve known package and cross-note scope.
- [x] Refuse truncated note results and duplicate/colliding browser paths instead of publishing partial evidence.
- [x] Require real Pandoc reproduction in a hash-pinned Windows CI job.

## v0.8 - Structure-preserving browser handoff

- [x] Apply safe metadata fixes to all eligible HTML files as one cumulative folder candidate.
- [x] Recheck the complete HTML/CSS/package scope before archiving.
- [x] Package every browser-selected file under a new root while retaining unchanged asset bytes.
- [x] Embed a local proof and after report, bind the analyzed HTML/CSS candidate with a visible SHA-256 ID, then read back and verify ZIP entry paths, sizes, CRC32 values, and SHA-256 hashes before download.
- [x] Block sensitive files, unsafe/colliding paths, stale async work, and bounded ZIP32/file-size limits without silently omitting selected files.
- [x] Bind every content entry to CRC32 and SHA-256 while keeping explicit browser memory ceilings.

## v0.9 - Direct export ZIP intake and repeat checks

- [x] Accept one bounded ZIP32 STORE/DEFLATE export without manual extraction or upload.
- [x] Verify central/local records, data descriptors, UTF-8/CP437/Unicode paths, CRC32, SHA-256, sizes, and record coverage before analysis.
- [x] Fail closed for traversal, conflicts, sensitive paths, encryption, ZIP64, Unix/macOS special files, hidden record gaps, damage, and resource ceilings.
- [x] Bind source archive SHA-256, stable imported-content ID, analysis candidate ID, and output ZIP manifest through report and proof.
- [x] Export comparison-compatible browser evidence and import an earlier JSON for new/resolved/worsened/persistent/unverified bilingual comparison.

## v0.10 - Verified publish capsule

- [x] Produce one deploy-ready ZIP with an explicit root entry page, assets, report, manifest, and portable preview links.
- [x] Auto-repair only uniquely resolvable package path/case/backslash defects inside a separate working copy.
- [x] Serve the exact final bytes on loopback and prove desktop, mobile, offline, local-resource, fragment, console, and unexpected-network behavior.
- [x] Mark a capsule publishable only when required deterministic and browser gates pass; otherwise deliver the working copy with exact blockers.
- [x] Document direct drag-and-drop deployment to static hosts without taking control of user cloud accounts.

## v0.11 - Verified publish pipelines

- [x] Add `kind: publish` to the Composite Action without granting deployment permissions.
- [x] Bind one create-only CLI command result to one exact validated Action run; never scan a shared output root for the latest directory.
- [x] Preserve and upload a validated working copy before enforcing deterministic/browser blockers.
- [x] Expose stable capsule, content, GitHub Artifact, report, proof, and checksum outputs for downstream read-only jobs.
- [x] Prove success and active-content blocking through real GitHub-hosted Artifact download and independent revalidation.

## v1.0 criteria

- Stable report and adapter contracts.
- End-to-end fixture evidence on every supported platform.
- Bounded false-positive review for all default detectors.
- Upgrade and compatibility policy.
- Security review of browser mutations, evidence storage, and CI use.

## Good first issues

- Add a positive RTL fixture that must not produce a finding.
- Publish more reviewed breakpoint fixtures for foldables and landscape layouts without expanding the default runtime blindly.
- Improve Markdown rendering for screenshot galleries.
- Add JSON Schema tests for example reports.
- Document integration with an existing Playwright project.

Open a scenario proposal before adding a default test. Every new default scenario needs a safety boundary, capability probe, positive fixture, negative fixture, evidence rule, and runtime budget.
