# Browser adapter selection

Use one adapter for a run and record its capabilities. Do not mix evidence from unrelated browser sessions.

## Capability matrix

| Capability | Bundled CLI | Codex browser | Project Playwright |
| --- | --- | --- | --- |
| Navigate and inspect DOM | Required | Required | Required |
| Screenshots | Required | Required | Required |
| Viewport emulation | Required | Usually supported | Required |
| Fresh context per scenario | Required | Preferred | Required |
| Console/page errors | Required | Adapter-dependent | Required |
| Network abort/delay/transform | Deep | Adapter-dependent | Required for deep network scenarios |
| Reduced-motion / color-scheme preferences | Deep | Adapter-dependent | Required for preference scenarios |
| Authenticated storage state | Supported | Session-dependent | Supported |
| Bounded same-origin link discovery | Supported | Manual | Project-dependent |
| CDP page zoom | Unsupported | Adapter-dependent | Chromium only |
| axe-core | Bundled in Deep | Adapter-dependent | Only when already installed |
| Safe journeys, navigation keys, and path assertions | Supported | Manual | Project-dependent |
| Network reliability budgets | Supported | Adapter-dependent | Project-dependent |
| HEAD-only same-origin link integrity | Supported | Manual | Project-dependent |
| Response/origin security policy | Supported | Adapter-dependent | Project-dependent |

Probe capabilities; do not infer them from the adapter name.

## Bundled CLI

Prefer `scripts/audit.mjs` when it can resolve `playwright-core` or `playwright` and find an already-installed Chrome, Edge, or Chromium executable. It never downloads a browser. Run it from the target repository so output stays under that repository:

```bash
node <skill-dir>/scripts/audit.mjs <url> --mode quick --fail-on major
```

Do not assume a missing `node` command means Node is unavailable. In Codex desktop, first use the available workspace dependency locator to obtain the bundled Node executable and `node_modules` directory. Invoke the absolute executable and set `NODE_PATH` for that process only. This keeps the one-prompt workflow working without asking the user to modify PATH or install a second runtime.

The CLI creates a fresh context per scenario and page, applies bounded protocol mutations, takes real screenshots, invokes `report.py`, and records the system browser version without persisting its local executable path. It can discover a validated project config, safely crawl bounded same-origin links, load user-supplied Playwright storage state without persisting it, evaluate declarative checks and safe journeys, enforce Core Web Vital and network reliability budgets, perform bounded HEAD-only same-origin link checks, inspect explicit response/origin/form security policy, and run bundled axe-core in Deep mode. Use `--compare <before-report.json>` after a source fix to produce strict verification, or `--baseline <before-report.json>` to gate regressions while preserving known debt. A missing detector in the after run counts as resolved only when its proving scenario completed successfully.

The standalone Deep adapter currently reports real page zoom as `unsupported`. It evaluates reduced-motion and declared dark-scheme behavior, delays safe same-origin fetch/XHR requests, returns bounded synthetic 503 responses for safe GET API requests, transforms only safe top-level JSON arrays for network scenarios, and runs packaged axe-core with bounded evidence.

## Codex browser

Use the installed browser-control skill and follow its setup and documentation exactly. Prefer it because it keeps the first run dependency-free for the user.

For each scenario:

1. Open a fresh context when the browser API exposes one.
2. Otherwise open a new tab, navigate from a clean URL, and disclose reduced isolation.
3. Use browser-side evaluation only for the bounded mutations in the test protocol.
4. Use native screenshot and DOM inspection functions for evidence.
5. Mark a scenario `unsupported` when the documented browser API lacks a required capability.

Do not substitute generic web search, HTTP fetching, or static source inspection for a requested browser audit.

## Project Playwright

Use custom project test code only when the target repository already declares Playwright or the user explicitly asks to install it. Prefer the bundled CLI for the standard scenarios.

1. Read the repository instructions and Playwright configuration.
2. Keep audit code outside production bundles. Prefer a temporary or repository-approved test directory.
3. Launch the browser configured by the project and record its executable or channel.
4. Use a fresh `BrowserContext` for baseline and every scenario.
5. Register console, page-error, failed-request, and HTTP-error listeners before navigation.
6. Do not modify the repository lockfile during an audit unless the user explicitly authorized setup changes.
7. Remove temporary audit code after evidence is persisted, unless the user asked to keep a regression test.

## No usable adapter

Stop with a preflight result, not an empty audit. Explain which capability is missing and offer one smallest next step:

- open the target in the Codex in-app browser; or
- add Playwright to the target project under the project's package manager policy.

Never silently install Chromium, change system browser settings, or claim that source-code inspection is equivalent to runtime testing.
