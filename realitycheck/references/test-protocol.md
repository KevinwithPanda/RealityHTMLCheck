# RealityCheck test protocol

## Browser-free plan preflight

When the user asks what an audit will do or requires approval before navigation, resolve the effective project policy with `audit.mjs plan` first. The plan command must not load Playwright, discover a browser, request the target, or mutate source. Validate its JSON contract and semantic ID before presenting the bilingual HTML. Treat page and scenario totals as conservative ceilings and never treat the preview as passing evidence.

The plan may disclose target origin/path, viewport dimensions, policy-family counts, severities, and governance counts. It must reduce selectors, routes, exclusions, waiver reasons, authentication inputs, and browser-storage state to non-sensitive counts or explicit non-retention statements. Query values and fragments must be absent.

## Contents

1. Run invariants
2. Baseline
3. Quick scenarios
4. Deep scenarios
5. Detectors
6. Classification and confidence
7. Evidence limits

## 1. Run invariants

- Test only a developer-controlled or explicitly authorized target.
- Use a fresh browser context per scenario when available. Otherwise use a fresh tab and clean navigation, disclose reduced isolation, and skip unsafe network mutations.
- Keep scenario order stable: baseline, configured responsive viewports, long text, RTL, image failure, keyboard, then optional deep scenarios.
- Use a fixed seed. The default is `42`.
- Never click or submit a business action. Keyboard testing sends only `Tab` and `Shift+Tab`.
- Bound every DOM scan to 2,000 elements, every text mutation to 80 nodes, console events to 500, and network records to 1,000.
- Do not use `networkidle` as the only readiness signal.
- Save only evidence needed to prove a finding or scenario status.

### Settle check

After `DOMContentLoaded`, sample these values at least three times over a 500ms window:

- visible body text length;
- document scroll height;
- element count;
- visible interactive element count.

Treat the page as settled when samples stop changing materially. Cap the wait at the configured timeout. A settle timeout is a warning, not an automatic failure.

### Common measurements

Collect at every checkpoint when supported:

- viewport width and height;
- document scroll width and height;
- visible text length;
- visible interactive element count;
- page title and final URL;
- console errors, uncaught page errors, failed requests, and HTTP 4xx/5xx responses;
- screenshot path;
- scan counts and truncation flags.

## 2. Baseline

Open the requested URL in a standard desktop viewport, preferably 1440x900. Register runtime listeners before navigation.

Capture:

- one full-page or viewport screenshot;
- common measurements;
- detector observations;
- browser and adapter capability notes.

Baseline defects are `existing`. Do not copy a baseline observation into every scenario. Use it only for fingerprint comparison and the report's baseline section.

Stop the run if the baseline cannot navigate or render meaningful content. Authentication walls, build errors, and TLS errors are preflight failures unless the user intentionally targeted them.

## 3. Quick scenarios

### Responsive viewport matrix

Purpose: expose breakpoint-specific overflow, fixed-width layouts, clipped text, unreachable controls, and severe touch-target loss.

Run each validated project viewport as an independently named scenario in its own fresh context. When no matrix is configured, use the backward-compatible default:

```text
viewport: 375x812
screen: 375x812 when supported
touch-target heuristic: enabled
```

Capture a screenshot and terminal status for every configured viewport, even if another size fails. Compare each responsive layout with the desktop baseline. `touch` enables the conservative target-size detector; it does not imply device, user-agent, screen, or gesture emulation. Do not impersonate a branded phone. Mark an individual checkpoint unsupported if the adapter cannot apply its dimensions; do not simulate responsiveness by adding CSS classes.

### `long-text`

Purpose: expose UI built only for short English fixtures.

Use the fixed seed to select at most 80 visible text nodes. Exclude `script`, `style`, `code`, `pre`, `svg`, `canvas`, `input`, `textarea`, and editable content. Accept original trimmed lengths from 1 to 80 characters.

Prioritize buttons, links, labels, table cells, navigation items, headings, badges, and chips. Use these deterministic fixture classes in a stable cycle:

```text
超长客户名称：上海现实检查与可靠性工程联合实验室
订单状态：正在等待跨区域库存同步与最终人工复核
Project-Aurora-Internationalization-Regression-Verification
https://example.invalid/a/very/long/path/without/break/opportunities
👩🏽‍💻🧪 RealityCheck 10,000,000.00
```

Record a truncated before/after value and stable selector for each mutation. Rerun clipping, overflow, and offscreen-control detectors. Findings must be based on new or worsened measurements, not merely the presence of long text.

### `rtl-arabic`

Purpose: expose physical-direction CSS, overlap, and ordering assumptions.

Set `document.documentElement.lang` to `ar` and `dir` to `rtl` as early as the adapter safely allows. Replace a bounded subset of short labels with deterministic Arabic fixtures; do not claim to translate the page.

Record original and applied `lang`/`dir`, mutation count, and adapter timing. Run layout detectors. Describe this as a directionality stress test, not a localization-quality review.

### `image-failure`

Purpose: verify that missing images do not collapse layout, hide critical meaning, or trigger uncaught errors.

Preferred method: before navigation, abort requests whose resource type is `image`, block service workers when the adapter supports it, and mark those aborts as expected mutations.

Safe fallback: after baseline navigation, replace visible image `src` values with unique same-origin missing URLs, preserving truncated originals in mutation records. The fallback is medium confidence for network behavior because it happens after initial load.

Do not report expected aborted image requests as generic failed-request findings. Run layout and accessibility observations in the failed-image state.

### `keyboard-tab`

Purpose: detect obvious keyboard reachability and focus-visibility failures without activating controls.

1. Start from `body` or the first reasonable focus origin.
2. Send at most 50 `Tab` presses.
3. Stop early when a stable focus loop repeats.
4. Record tag, role, truncated accessible name, stable selector, bounding box, viewport state, outline, and box-shadow for every step.
5. Never type into inputs, press Enter/Space, click, or submit.

High-confidence failures include focus never leaving `body`, focus entering hidden or disabled elements, and a verified focus trap. Missing visible focus is high confidence only when computed styles and before/after evidence prove it; otherwise use low confidence.

## 4. Deep scenarios

Run a deep scenario only when its capability probe succeeds.

### `page-zoom-200`

Use real Chromium page zoom through CDP or a documented equivalent. Do not substitute `deviceScaleFactor`. Record the method and actual factor. If real page zoom is unavailable, mark `unsupported`.

### `reduced-motion`

Open a fresh context with `prefers-reduced-motion: reduce`. Inspect active Web Animations after settling. Ignore progress indicators and `aria-busy` regions; report only repeated, non-progress motion that remains running or pending. Record the target selector, computed duration, and iteration count. This is a bounded heuristic, not a vestibular-safety certification.

### `dark-scheme`

Open a fresh context with `prefers-color-scheme: dark`. Run the detector only when the page declares a matching CSS media rule. For visible leaf text, compare computed opaque foreground color with the first opaque ancestor background and apply the size-adjusted 4.5:1 or 3:1 threshold. Cap samples at ten. Treat transparency, gradients, images, and complex blending as requiring visual review; use Medium confidence for this approximation.

### `slow-api`

Require pre-navigation network routing and a fresh isolated context. Delay at most 30 same-origin `fetch`/XHR requests by 3,000ms. Never delay documents, scripts, stylesheets, fonts, or third-party requests.

Capture two checkpoints:

- `during-loading`, about 1,000ms after DOMContentLoaded;
- `final-recovered`, after delayed requests continue and the page settles.

The delay itself is not a failure. Detect blank loading states, missing status feedback, uncaught errors, permanent spinners, and failure to recover.

### `api-error`

Require pre-navigation routing and a fresh isolated context. Return HTTP 503 with a synthetic JSON body for at most five same-origin GET `fetch`/XHR requests. Never mutate documents, scripts, styles, non-GET requests, or third-party traffic. Report a high-confidence Major only when requests were transformed and the settled UI exposes no visible error, unavailable, offline, or retry message and no visible semantic alert region.

### `empty-data`

Require safe response transformation and a fresh isolated context. Consider only same-origin JSON responses under 2MB from GET or clearly read-only GraphQL queries.

Transform only:

- a top-level array to `[]`;
- array fields named `data`, `items`, `results`, `records`, `rows`, `edges`, or `nodes` to `[]`;
- sibling counts named `total`, `count`, or `totalCount` to `0`.

Skip objects containing `accessToken`, `refreshToken`, `session`, `currentUser`, `featureFlags`, or `config`. Never persist the original response body. If no safe candidate exists, mark the scenario `skipped` with a reason.

### `axe`

The bundled CLI injects its packaged axe-core into a fresh Deep-mode context after the page settles. Other adapters may run it only when already exposed. Evaluate WCAG A/AA through 2.2 plus best-practice tags. Aggregate one finding per axe rule, cap the run at 50 violation rules and five sampled nodes per rule, omit raw node HTML, and state that automated scanning cannot establish WCAG compliance. A missing or failed engine must produce `unsupported` or `failed`, never `passed`.

Suggested impact mapping:

| axe impact | Severity |
| --- | --- |
| critical | critical |
| serious | major |
| moderate | minor |
| minor | minor |
| unknown | info |

## 5. Detectors

### `document-horizontal-overflow`

Report when `documentElement.scrollWidth > innerWidth + 2`. Locate up to ten visible culprits whose rectangles cross the viewport or exceed its width. A critical control outside the viewport or overflow greater than 25% of viewport width is normally Major; small decorative overflow is Minor or Info.

### `element-text-clipping`

Scan visible text elements. High-confidence horizontal clipping requires `scrollWidth > clientWidth + 2` plus `overflow-x: hidden|clip`, ellipsis, or constrained nowrap behavior. Vertical clipping requires `scrollHeight > clientHeight + 2` plus hidden or clipped vertical overflow.

Ignore invisible, zero-size, decorative, and intentionally collapsed elements. Save at most 200 characters of text.

### `offscreen-critical-control`

Consider enabled buttons, inputs, selects, textareas, submit controls, and button/link roles. Report high confidence only when the control is visible, is not explained by a scrollable ancestor, is fully outside the viewport, and was inside the viewport at baseline.

For narrow-screen layout checks, treat horizontal loss of access as the default failure. A control below the initial fold is normally reachable by vertical document scrolling and is not offscreen unless separate evidence proves the scroll path is blocked.

### Runtime detectors

- `page-error`: new uncaught exceptions are normally Major; browser/page crashes are Critical.
- `console-error`: record console level `error`, deduplicate stable messages, and filter known favicon or extension noise.
- `failed-request`: exclude expected scenario aborts; prioritize same-origin API, script, and stylesheet failures.
- `http-error-response`: same-origin 500+ is normally Major; interpret 401/403 and resource 404s in context.

Never persist full headers or response bodies.

### Baseline controls and mobile target size

- Report a visible enabled `button`, form control, link, or button role without an accessible name as Major / Medium confidence. Preserve a stable selector and a bounded element sample.
- Ignore text descendants marked `aria-hidden="true"` when approximating a control's accessible name. Preserve native associated labels, button text, relevant input values, image alternatives, title, and placeholder fallbacks.
- Report a missing root document language or empty browser title as Minor / High confidence.
- Aggregate duplicate non-empty document IDs into one Minor / High-confidence finding.
- Report visible adjacent heading levels that skip an intermediate level as Minor / Medium confidence; nested component boundaries and document outlines still need human review.
- At every configured checkpoint with `touch: true`, report visible interactive targets smaller than 24x24 CSS pixels as Minor / Medium confidence. This floor catches severe usability loss; it is deliberately lower than common design-system recommendations to reduce false positives.

### Declarative project checks

Run only config-validated assertions: existence, visibility, enabled state, accessible name, attribute match, bounded count, horizontal overflow, and minimum size. Scope checks by normalized route globs. A failed custom requirement is High confidence because the project explicitly declared the selector and expectation. Never execute JavaScript or shell text supplied through config.

### Performance budgets

Install buffered LCP and layout-shift observers before baseline navigation. After settle, record navigation duration, DOMContentLoaded duration, TTFB, FCP, LCP, CLS, resource request count, transferred KiB when available, and DOM node count. Compare only configured limits. These are lab observations, not field RUM. A zero transfer size or paint value may mean the browser/server omitted timing data; do not infer that the page transferred or painted nothing. Budget changes require product approval and must not be used as an automatic repair.

### Network reliability policies

Register request lifecycle listeners before baseline navigation. Apply the validated `api` or `all` scope consistently to HTTP errors, pre-response failures, duration measurements, and third-party request counts. A slow-request policy requires both its duration threshold and allowed count. Record bounded samples only after removing URL credentials, fragments, and the entire query string; never inspect or persist response bodies. Do not turn a failing endpoint into an ignored endpoint automatically. When a configured maximum replaces the default generic HTTP/failure detector, preserve the generic detector for request classes not governed by that maximum.

### Link integrity policy

Collect bounded `a[href]` targets after baseline settle without clicking. Keep only canonical same-origin HTTP(S) URLs, remove credentials/query/fragment, and apply merged crawl exclusions before any request. Use HEAD only, a maximum of five concurrent probes, the configured timeout, and no more than five manually validated same-origin redirects. Never follow an external or excluded redirect. Treat 4xx/5xx and transport errors as failures, 405/501 as unsupported, and safety-excluded paths as skipped. Evidence may contain at most twenty query-free failure samples and must not include response bodies or headers. Do not introduce a GET fallback.

### Publishing metadata policy

Run only explicitly configured publishing rules in the clean baseline. Count title, meta description, canonical, viewport, document language, robots noindex, and h1 state without retaining title or description copy in detector evidence. Store title/description lengths and element counts; for canonical links store only bounded validity, origin, and pathname fields with credentials, queries, and fragments removed. A missing `lang` remains the built-in `document-language-missing` finding so the policy does not create a duplicate. Do not infer SEO performance, search-engine indexing, accessibility conformance, or content quality from a passing structural contract. Never add or remove `noindex` automatically without confirming that the route is intended for public indexing.

### Explicit visual regression policy

Capture the visual-comparison image from the clean desktop baseline after settle, with animations disabled and the caret hidden. Apply only the validated declarative mask selectors and use one fixed mask color in both current and approved images. Derive the approved PNG key from pathname only; never persist query or fragment values. Reject absolute/parent/symlink baseline paths and bound encoded bytes, decoded pixels, mask count, pixel threshold, and changed-pixel ratio. A missing, unreadable, oversized, or dimension-incompatible baseline must stay visible as an explicit finding; never silently skip configured policy.

Store current, approved, and magenta diff images only when needed for review. Report dimensions, changed/total pixels, exact ratio, threshold, per-channel tolerance, dimension match, and mask count. Do not claim perceptual similarity: the detector is exact pixel comparison after a bounded channel tolerance. Do not automatically approve, overwrite, or loosen policy during an audit. First approval requires a reviewed report; replacing different bytes requires the separate explicit replacement flag. Keep runtime environments consistent, and treat approval as a human design decision rather than proof of usability, accessibility, or correctness.

### Safe declarative journeys

Run configured journeys only once from the primary target, in a fresh context. Resolve `startPath` and `goto` paths against the audited origin and enforce the merged route exclusions. An `assert-url` compares pathname only and must not retain query or fragment state. A click must match exactly one element and be a same-origin allowed link, semantic tab/disclosure, or non-submit button explicitly marked `data-realitycheck-safe="true"`. Reject destructive labels and all submit controls. A key press must target exactly one non-editable structural widget and use only Escape, arrow, Home/End, or Tab navigation; reject Enter, Space, printable input, and editable controls. Never fill inputs, read form values, or activate login, consent, purchase, delete, publish, send, or logout actions. Capture bounded step traces and screenshots; stop on the first failure so later steps cannot obscure the root transition. Keep one trace entry per step, including the measured state for a failed assertion.

### Security policy detectors

Run only explicitly configured security policy. Required-header evidence records name/presence/status, not header values. Mixed-content checks apply only to HTTPS documents. Secure-form inspection records bounded method/protocol/origin metadata and whether a password field exists, never its value, and never submits. Third-party budgets and allowlists persist unique origins only. Treat a policy violation as High confidence because the project declared the exact boundary; do not infer comprehensive application security from a passing baseline.

### Aggregate browser storage privacy budgets

Run only explicitly configured privacy budgets in the clean baseline context. Use browser-context Cookie state so HttpOnly cookies are included, then retain only total count, UTF-8 name/value bytes, and the count whose normalized domain is not the final document host or one of its parent domains. Measure localStorage and sessionStorage in-page, summing UTF-8 key/value bytes, but return only availability, entry count, and byte total. Never persist names, keys, values, expiry, paths, same-site flags, or exception messages.

Compare each configured maximum independently and emit one High-confidence finding per exceeded budget. If any configured storage surface cannot be measured, emit an explicit measurement-unavailable finding; unknown must never become a zero-value pass. Do not clear, migrate, or rewrite state during an audit. A pass is evidence only for the configured aggregate threshold in that isolated browser run, not consent, tracker, retention, data-flow, or legal-compliance proof.

### `blank-or-stuck-state`

A high-confidence blank state requires all of the following: fewer than 20 visible text characters, no visible heading/form/button/link/meaningful image, and a nonblank baseline.

A high-confidence stuck loading state requires a loading indicator during the delay, the same state after requests recover, completed API requests, and no recovery in content metrics.

### Focus detectors

Report verified lack of focus movement, hidden/disabled focus targets, traps, and unreachable critical controls. Treat inferred visual-order problems and ambiguous focus styling as low confidence.

### GitHub summary and annotations

Consume only schema-valid page reports and, when a directory is supplied, fail if another discovered RealityCheck artifact is invalid. Group by the exact requested target internally and select only its newest completed run; display origin plus pathname without credentials, query, or fragment. Count waived findings but never emit an annotation for them. Sort active findings by severity and confidence, map Critical/Major to Error, Minor to Warning, and Info/Low-confidence observations to Notice, and cap annotations at 50.

Treat titles, rules, remediation, owners, targets, and scenario labels as hostile. Normalize controls and whitespace, neutralize command-looking `::` sequences, escape percent signs plus property colons/commas, bound title/message lengths, and do not claim a repository filename or line number without source evidence. Keep the Markdown summary below GitHub's per-step limit and report how many annotations were omitted by the configured cap. A newer passing report must remove stale findings from the current summary.

### Policy change review

Compare only two schema-valid config files explicitly supplied by the caller. Evaluate effective defaults and structural policy settings without reading Git history or application source. Classify clear enforcement loss as `weakened`, clear added/tighter enforcement as `strengthened`, and ambiguous route, selector, or breakpoint intent as `review`. A weakening fails only after all JSON/Markdown/HTML evidence is written. Do not copy base URLs, filesystem paths, selectors, route globs, custom text, origins, or waiver reasons into the review. Never claim that structural comparison replaces security, legal, product, or device-market approval.

### GitHub issue draft handoff

Consume only schema-valid `repair-plan.json` artifacts supplied as files or discovered below explicit directories. Deduplicate by the stable finding fingerprint, reject one fingerprint mapping to conflicting rule IDs, and retain every distinct run/scenario/report anchor as an occurrence. Strip URL credentials, queries, and fragments. Neutralize `@` mentions and HTML-like text before it reaches GitHub-flavored Markdown. Separate low-confidence findings into review and keep waivers explicit instead of silently discarding them. Preserve required proving scenarios, fingerprint absence, healthy-baseline, and no-same-level-regression acceptance criteria. Generate local JSON, bilingual Markdown/HTML, and CSV only; never call an issue API, infer GitHub usernames from team names, or submit/assign work without human approval.

### Release decision handoff

Consume only recognized, schema-valid RealityCheck control artifacts supplied as explicit files or discovered below explicit directories. Select the newest artifact for each observed control and record the candidate count; recommend explicit file paths when scope must be exact. Require at least one named control, bound the freshness limit to 1–8760 hours, treat a required missing/stale control as NO-GO, preserve REVIEW separately from operational failure, and let a failed control override review. Bind every selected source with SHA-256 and a portable path on the same filesystem volume. Do not copy target URLs, page titles, findings, waiver reasons, screenshots, trust error text, or other private source content into the decision. Recompute counts, policy membership, decision, and the stable release ID during validation. Generate local JSON, bilingual Markdown/HTML, and tri-state exit codes only; never trigger deployment or represent the artifact as approval by a person or organization.

## 6. Classification and confidence

Create a stable cross-run fingerprint from:

```text
rule ID + scenario ID + normalized URL pathname + normalized selector
```

Do not include changing measurements such as pixel offsets or occurrence counts. Group selector-less runtime events into one finding per rule and scenario so their fingerprint remains unique.

Prefer selectors in this order: `data-testid`, stable ID, role plus truncated accessible name, tag plus stable class subset, and finally a DOM path no deeper than six levels.

- `existing`: same fingerprint at baseline and in a scenario.
- `new`: scenario fingerprint absent from baseline.
- `worsened`: same fingerprint with a measurement beyond the documented tolerance.
- `resolved`: baseline fingerprint absent from the scenario; informational.

Use High confidence for directly measured conditions with a stable target. Use Medium when evidence is direct but an adapter fallback reduces certainty. Use Low for a useful heuristic that needs human confirmation.

Do not raise severity because a screenshot merely looks bad. Raise it only for measured loss of access, crashes, unrecovered state, or clear data risk.

## 7. Evidence limits

- Screenshot: baseline plus one proving screenshot per finding state when possible.
- DOM text: 200 characters per node.
- Console text: 500 characters per unique event.
- Stack: first five useful lines after redaction.
- Selector: 300 characters.
- Finding summary: 1,000 characters.
- Notes and warnings: 1,000 characters each.

Record caps and truncation as warnings. Missing screenshot support does not erase otherwise strong measurements, but it must be disclosed.
