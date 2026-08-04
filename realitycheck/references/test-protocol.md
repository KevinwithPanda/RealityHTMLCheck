# RealityCheck test protocol

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
- Keep scenario order stable: baseline, mobile, long text, RTL, image failure, keyboard, then optional deep scenarios.
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

### `mobile-375`

Purpose: expose narrow-screen overflow, fixed-width layouts, clipped text, and unreachable controls.

Required setup:

```text
viewport: 375x812
screen: 375x812 when supported
touch/mobile emulation: optional and recorded
```

Do not impersonate a branded phone. Run layout detectors and capture the actual viewport dimensions. Mark unsupported if the adapter cannot change the viewport; do not simulate mobile by adding CSS classes.

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
- At the 375px checkpoint, report visible interactive targets smaller than 24×24 CSS pixels as Minor / Medium confidence. This floor catches severe usability loss; it is deliberately lower than common design-system recommendations to reduce false positives.

### Declarative project checks

Run only config-validated assertions: existence, visibility, enabled state, accessible name, attribute match, bounded count, horizontal overflow, and minimum size. Scope checks by normalized route globs. A failed custom requirement is High confidence because the project explicitly declared the selector and expectation. Never execute JavaScript or shell text supplied through config.

### Performance budgets

Install buffered LCP and layout-shift observers before baseline navigation. After settle, record navigation duration, DOMContentLoaded duration, TTFB, FCP, LCP, CLS, resource request count, transferred KiB when available, and DOM node count. Compare only configured limits. These are lab observations, not field RUM. A zero transfer size or paint value may mean the browser/server omitted timing data; do not infer that the page transferred or painted nothing. Budget changes require product approval and must not be used as an automatic repair.

### Network reliability policies

Register request lifecycle listeners before baseline navigation. Apply the validated `api` or `all` scope consistently to HTTP errors, pre-response failures, duration measurements, and third-party request counts. A slow-request policy requires both its duration threshold and allowed count. Record bounded samples only after removing URL credentials, fragments, and the entire query string; never inspect or persist response bodies. Do not turn a failing endpoint into an ignored endpoint automatically. When a configured maximum replaces the default generic HTTP/failure detector, preserve the generic detector for request classes not governed by that maximum.

### Link integrity policy

Collect bounded `a[href]` targets after baseline settle without clicking. Keep only canonical same-origin HTTP(S) URLs, remove credentials/query/fragment, and apply merged crawl exclusions before any request. Use HEAD only, a maximum of five concurrent probes, the configured timeout, and no more than five manually validated same-origin redirects. Never follow an external or excluded redirect. Treat 4xx/5xx and transport errors as failures, 405/501 as unsupported, and safety-excluded paths as skipped. Evidence may contain at most twenty query-free failure samples and must not include response bodies or headers. Do not introduce a GET fallback.

### Safe declarative journeys

Run configured journeys only once from the primary target, in a fresh context. Resolve `startPath` and `goto` paths against the audited origin and enforce the merged route exclusions. An `assert-url` compares pathname only and must not retain query or fragment state. A click must match exactly one element and be a same-origin allowed link, semantic tab/disclosure, or non-submit button explicitly marked `data-realitycheck-safe="true"`. Reject destructive labels and all submit controls. A key press must target exactly one non-editable structural widget and use only Escape, arrow, Home/End, or Tab navigation; reject Enter, Space, printable input, and editable controls. Never fill inputs, read form values, or activate login, consent, purchase, delete, publish, send, or logout actions. Capture bounded step traces and screenshots; stop on the first failure so later steps cannot obscure the root transition. Keep one trace entry per step, including the measured state for a failed assertion.

### Security policy detectors

Run only explicitly configured security policy. Required-header evidence records name/presence/status, not header values. Mixed-content checks apply only to HTTPS documents. Secure-form inspection records bounded method/protocol/origin metadata and whether a password field exists, never its value, and never submits. Third-party budgets and allowlists persist unique origins only. Treat a policy violation as High confidence because the project declared the exact boundary; do not infer comprehensive application security from a passing baseline.

### `blank-or-stuck-state`

A high-confidence blank state requires all of the following: fewer than 20 visible text characters, no visible heading/form/button/link/meaningful image, and a nonblank baseline.

A high-confidence stuck loading state requires a loading indicator during the delay, the same state after requests recover, completed API requests, and no recovery in content metrics.

### Focus detectors

Report verified lack of focus movement, hidden/disabled focus targets, traps, and unreachable critical controls. Treat inferred visual-order problems and ambiguous focus styling as low confidence.

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
