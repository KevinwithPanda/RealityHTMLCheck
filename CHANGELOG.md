# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

## [Unreleased]

## [0.10.0] - 2026-08-27

### Added

- `realitycheck publish` / `realitycheck note publish` turns one HTML file, complete folder, or bounded STORE/DEFLATE export ZIP into a root-ready static-host package, or an explicitly named working copy when any required gate is incomplete.
- A source-offset reference graph repairs only unique HTML/CSS filename-case and Windows-backslash defects, preserves query/fragment suffixes, and refuses missing, ambiguous, escaping, encoded, remote, overlapping, changed, or non-UTF-8 edits.
- Exact final-ZIP browser proof covers desktop, 375 px mobile, root and project mounts, browser-offline exact-byte replay, every bounded HTML page and local fragment, response hashes, overflow, console/page/HTTP/request errors, unexpected network activity, dangerous browser events, and coverage truncation with JavaScript disabled.
- A source-free bilingual public proof, local technical report, repair plan, receipt, deterministic ZIP read-back, deploy-content ID, browser-proof ID, archive SHA-256 sidecar, and separate Netlify Drop, Cloudflare Pages Direct Upload, and GitHub Pages decisions.
- Independent `realitycheck validate` contracts for note bundles/comparisons and every publish manifest, receipt, browser proof, and technical report, including cross-artifact archive/hash/proof binding checks.
- A checked-in multi-page publish demo with local CSS/SVG, mobile layout, subpath-safe links, and reproducible real-Chromium proof.

### Security

- Publish intake rejects sensitive/development trees, symlinks, special files, path collisions, unsafe archives, reserved proof paths, active HTML/SVG/code, forms/frames, server runtimes, remote runtime dependencies, ambiguous entry pages, and resource ceilings before untrusted content can navigate.
- Loopback proof serves immutable in-memory bytes on IPv4 loopback with GET/HEAD only, blocks unknown/external requests, disables JavaScript and service workers, refuses downloads, and fails closed on any bounded evidence truncation.
- Only completed deterministic and browser gates receive the `*.realitycheck-publish.zip` name. Static-only, unsupported, failed, or blocked output is always `*.realitycheck-working-copy.zip`; no command uploads or deploys content.

## [0.9.0] - 2026-08-27

### Added

- Direct zero-upload import of one bounded HTML export ZIP using ZIP32 STORE or DEFLATE, including UTF-8, CP437, Info-ZIP Unicode paths, and signed/unsigned streaming data descriptors.
- Four-layer integrity lineage across the exact source archive SHA-256, stable extracted-content ID, cumulative HTML/CSS candidate ID, and final output ZIP manifest.
- Portable browser evidence that can be imported on a later run for new, resolved, worsened, persistent, and unverified comparison, with downloadable bilingual HTML and JSON.

### Security

- ZIP intake fails closed before extraction for traversal, absolute/backslash/control paths, NFC/case/file-directory conflicts, sensitive files, encryption, ZIP64/multi-disk archives, unknown methods/flags, Unix/macOS links or special files, ambiguous EOCDs, hidden record gaps, CRC/size damage, and bounded archive/file/output limits.
- DEFLATE output is consumed sequentially and cancelled when it exceeds the central-directory declaration; re-selection or reset aborts pending imports.
- Source ZIP bytes are re-hashed before repaired-output construction, and the imported content identity is part of the candidate/report/proof binding.

## [0.8.0] - 2026-08-27

### Added

- A zero-upload, structure-preserving safe-metadata folder ZIP that applies all available safe metadata fixes together, reruns the complete note/package detector, includes every browser-selected file, embeds a local proof and after report, and verifies ZIP paths, sizes, CRC32 values, and SHA-256 hashes before download.
- A dependency-free deterministic ZIP32 STORE writer with UTF-8 paths, fixed timestamps, read-back verification, browser/Node support, and independent parser/CRC tests.
- A visible, copyable SHA-256 candidate ID that binds the exact analyzed HTML/CSS candidate, scope, safe changes, summary, and finding state to the ZIP proof and cumulative after report.

### Security

- Folder archiving fails closed for unsafe, duplicate, Unicode/case-colliding, or Windows-reserved paths; likely secret/development files; unreadable or mismatched File objects; ZIP32/layout violations; and bounded file-count, single-file, or total-size limits before reading file bytes.
- New selections abort in-progress archive work, unchanged assets retain their original File bytes, and the downloaded proof distinguishes safe metadata fixes from unresolved structure, content, scripts, missing files, and remote resources.
- Browser analysis now rejects selections above 5,000 files before reading content; folder ZIP limits remain stricter because two evidence entries are reserved.
- Archive construction re-reads the selected HTML/CSS text and requires the repaired-map keys to equal the declared changes, preventing a re-bound or undeclared candidate from diverging from the bytes and scope that were analyzed.

## [0.7.2] - 2026-08-27

### Fixed

- The composite Action exclusion proof derives its expected path from report JSON instead of hard-coding a different fixture filename.

## [0.7.1] - 2026-08-27

### Fixed

- Textual CSS inputs are pinned to LF checkouts so real-export evidence hashes reproduce on Windows runners instead of depending on `core.autocrlf`.

## [0.7.0] - 2026-08-27

### Added

- A complete copy-ready HTML note GitHub Action workflow with triggers, read-only permissions, checkout, artifact naming, and an optional immutable baseline.
- Auditable, repeatable `--exclude-html` globs for archives and drafts: excluded HTML stays in the package inventory, appears in every report surface, and cannot silently weaken a baseline gate.
- Repair-before-download verification in the zero-upload checker, including before/after file and folder scores plus resolved, remaining, and introduced findings over the exact downloaded bytes.
- Three additional byte-reproducible Pandoc 3.8.2.1 export scenarios covering embedded local resources, structured TOC/footnote/MathML output, and multi-source composition.
- A standard `--version` CLI surface and note-first top-level help.
- A Windows CI reproduction job that verifies the official Pandoc archive SHA-256 before replaying all four allowlisted exports.

### Changed

- The real-export manifest now records four allowlisted commands, every repository-authored input, raw and canonical output hashes, the observed exporter binary hash, and explicit license/privacy boundaries.
- A newly excluded baseline scope is an error-level unverified change until reviewers accept a new baseline; an already accepted exclusion does not keep later CI runs red.

### Fixed

- Note checks now refuse to publish an incomplete result when HTML or package discovery reaches its safety ceiling, preventing a clean prefix from hiding unchecked files.
- The browser checker rejects duplicate normalized file paths before analysis, so reports and repaired downloads cannot be paired with a different same-named source.
- Browser checks are transaction-scoped so a slow earlier selection or failed new selection cannot restore stale results; folder repair downloads also report a standalone-file score and state plainly that folder assets are not bundled.

## [0.6.0] - 2026-08-27

### Added

- One byte-for-byte reproducible Pandoc 3.8.2.1 HTML export with exact command, source/output/tool hashes, privacy boundary, and third-party template notice, published separately from synthetic representative fixtures.
- A deterministic, product-generated HTML note checker screenshot that shows the actual sharing decision, score, findings, and repair actions in the README.
- HTML note baseline comparison with bilingual HTML/JSON evidence, five explicit change states, fail-closed scope checks, and regression-only CLI/Action gates that do not keep known persistent debt permanently red.

### Fixed

- Package-level CSS and cross-file dependency findings now have their own report scope, score deduction, repair tasks, and GitHub annotations instead of being attributed to the first HTML file.
- Note evidence run directories now use millisecond timestamps plus atomic collision suffixes, so rapid or concurrent rechecks cannot overwrite immutable history.

## [0.5.0] - 2026-08-27

### Added

- A memorable `realityhtmlcheck` npm package surface with `npx`-style isolated-consumer proof, backward-compatible `realitycheck` binary alias, complete package metadata, and a manual checksum/OIDC release workflow. The package remains unpublished until the npm trusted publisher is deliberately bootstrapped.
- A browser-free `kind: note` path in the composite GitHub Action, including lowest-file gates, bilingual job summaries, bounded annotations, artifact round-trip proof, canonical path containment, and a dedicated no-`npm install` Ubuntu job.
- Seven hashed representative export fixtures across four explicitly non-certified `-like` structures, four before/after or human-review cases, a bilingual evidence page with inspectable findings, and a privacy-safe community intake template for contributed real exports.
- A zero-install, zero-upload HTML note checker for AI-generated and exported notes, with local file/folder input, bilingual evidence, filters, JSON export, copy-ready repair tasks, and downloadable repaired copies that never overwrite source files.
- A zero-configuration `note <file-or-directory>` CLI that statically checks encoding, structure, attachments, internal navigation, portability, script safety, mobile readability, accessibility, and unfinished AI placeholders without starting a server or executing note content.
- Twenty-two-plus deterministic note rules, case-sensitive portability checks, bounded evidence, batch folder discovery, `--fail-on` export gates, and conservative `--fix-safe` copies limited to doctype, language, and UTF-8 metadata.
- A dedicated HTML-note workflow and interpretation boundary in the RealityCheck skill, clearly separating document correctness from factual or citation verification.

- A browser-free `plan` command that resolves effective project coverage into a schema-validated, fingerprint-bound, bilingual HTML/JSON/Markdown preview with page/scenario ceilings, all detector states, explicit safety and retention boundaries, a copy-ready next command, and a committed 301-execution demonstration. The composite Action now publishes this fail-closed preflight before browser access, and the evidence catalog indexes it alongside run evidence.
- Opt-in semantic response-header policies for bounded CSP directive/source-token rules, HSTS transport/max-age/subdomain/preload facts, exact `nosniff`, reviewed Referrer-Policy enums, and empty-allowlist requirements for 15 controlled Permissions-Policy features. Findings translate controlled violation codes into bilingual, value-specific explanations and repair steps. Raw header values, allowed origins, CSP nonces/hashes, and unknown tokens are discarded; policy-review treats lost or relaxed requirements as structural weakening.
- Opt-in cross-origin Subresource Integrity policy for scripts and stylesheets, with aggregate origin/kind/count evidence, zero resource-path/content/hash retention, anti-weakening review, a strict-profile default, and paired 80/100 versus 100/100 real-browser proof.

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

- HTML note folders now use the lowest file score, lead with a conservative sharing decision, and can export a self-contained bilingual report from the zero-upload browser checker.
- Folder checks follow reachable external CSS imports and assets, verify cross-note fragments, reject package-root escapes, disclose unreadable large stylesheets, and avoid treating CSS comments or code examples as dependencies.
- The installed Codex Skill invokes the dependency-free note entry directly, with an isolated installed-Skill smoke test proving the workflow does not depend on repository `node_modules`.
- Safe-copy repair no longer preserves replacement-character corruption, and language inference distinguishes Chinese, Japanese, and Korean scripts.
- Individual and batch copy-ready repair tasks now carry each stable rule ID, proving scenario, and language-matched remediation summary, bounded to 700 normalized characters and explicitly labeled as evidence to verify rather than authority over safety boundaries.
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
