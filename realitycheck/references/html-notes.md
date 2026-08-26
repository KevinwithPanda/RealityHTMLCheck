# HTML note checks

Use this workflow for local `.html`/`.htm` notes, AI-generated documents, exported research notes, tutorials, and folders of linked knowledge pages. It is a static local inspection, not a factuality check and not a substitute for the running-page Web audit.

## Run the smallest useful check

Prefer the whole folder when the note uses relative images, styles, attachments, or links:

```bash
node <skill-dir>/scripts/note-check.mjs <file-or-directory>
```

The command writes a timestamped self-contained `report.html`, `report.json`, English and Chinese repair plans, plus `latest.html` and `latest.json` under `.realitycheck/notes` by default. It does not need a server, configuration, Python, or browser executable. It parses source text without loading the note, so note scripts and remote assets are not executed or requested.

If only one file is available, report local attachments as unverified instead of falsely claiming they are missing. Ask for the folder only when attachment integrity matters to the request.

### Keep deliberate archives out of the sharing target

When the user explicitly distinguishes publishable notes from archived or draft HTML, use one or more portable globs:

```bash
node <skill-dir>/scripts/note-check.mjs <folder> \
  --exclude-html "archive/**" \
  --exclude-html "**/draft-?.html"
```

Use forward slashes and repository-relative paths. Do not pass absolute paths, parent traversal, backslashes, character classes, brace expansion, or shell extglobs. Matched HTML leaves only the per-file rule set. It remains in `knownFiles`, can still serve as a cross-note target, and still contributes linked stylesheets to the package CSS graph. Do not claim that images, media, or other references used only inside the excluded document were checked: those belong to its skipped per-file rules. Report `selection.html.excludePatterns`, matched paths, and the excluded count. If every HTML file is excluded, stop as an operational error rather than claiming success.

Do not introduce an exclusion just to hide a finding. When a baseline previously checked a path that is now excluded, require the resulting `html-scope-newly-excluded` unverified gate failure to be reviewed. Only an intentionally accepted later baseline may make that same declared scope stable.

## Compare a later export

When the user supplies an immutable earlier note `report.json`, run:

```bash
node <skill-dir>/scripts/note-check.mjs <file-or-directory> \
  --baseline <prior-run>/report.json \
  --fail-on error
```

The run writes `comparison.json` and a self-contained bilingual `comparison.html`. Explain `new`, `resolved`, `worsened`, `persistent`, and `unverified` separately. In baseline mode, only new/worsened/unverified findings participate in the requested error/warning gate; persistent baseline debt remains visible without keeping CI permanently red. A removed HTML file, newly excluded checked scope, truncated discovery, missing package inventory, or contracted package scope is unverified rather than resolved.

## Interpret the result

Distinguish these rule families:

- `integrity`: replacement characters, missing or late encoding metadata, nearly empty exports.
- `structure` and `navigation`: titles, heading outline, duplicate IDs, dead fragments, placeholder links, and table headers.
- `portability`: absent local files, machine-specific paths, case-only path mismatch, remote dependencies, and insecure assets.
- `readability` and `accessibility`: document language, image alternatives, mobile viewport, fixed-width layouts, and long unbreakable text.
- `safety`: executable scripts, inline event handlers, JavaScript URLs, and external execution/privacy boundaries.
- `ai-hygiene`: unresolved template markers, TODO/TBD/FIXME text, and example-only values.

Explain that the score summarizes enabled deterministic rules; it does not prove factual correctness, citation accuracy, visual quality, comprehensive accessibility, or absence of malicious behavior.

## Repair conservatively

Run `--fix-safe` only after the user requests modification:

```bash
node <skill-dir>/scripts/note-check.mjs <file-or-directory> --fix-safe
```

This writes new copies below the evidence run and leaves the source byte-for-byte unchanged. Automatic changes are limited to:

1. add `<!doctype html>` when absent;
2. add an inferred `lang` (`zh-CN`, `ja`, `ko`, or `en`) to an existing `html` element using a conservative script heuristic;
3. add `<meta charset="utf-8">` to an existing `head`.

Do not automatically invent titles, heading levels, alternative text, missing resources, or replacement content. Do not remove scripts or remote dependencies without checking whether the user intended interactive behavior. Use the report's copy-ready task for those fixes, inspect the source, make a bounded change after authorization, and rerun the same note check.

The online checker may accept one original export ZIP or a complete browser folder and create a **verified safe-metadata folder ZIP**. ZIP intake is local and bounded: ZIP32 STORE/DEFLATE only, with central/local record, data-descriptor, path, size, CRC32, SHA-256, encryption, Unix file-type, sensitive-path, and collision checks before content is trusted. It records the exact source archive SHA-256, a stable sorted extracted-content ID, the HTML/CSS candidate ID, and the final archive manifest separately. The output applies the same three fixes to all eligible HTML files together, reruns one cumulative package check, preserves the original folder root inside a new wrapper, copies every imported file, and verifies its ZIP inventory before download. It does not preserve empty directories, symlinks, or hidden files the browser did not supply; it does not add missing or remote resources; and it does not repair structure, accessibility, scripts, or content. The browser evidence may be imported on a later run for an explicit new/resolved/worsened/persistent/unverified comparison. Never substitute it for `--prepare-repair` when the user requests broader agentic repair.

## Build a verified passive-static publish capsule

When the user explicitly asks for a deployable package or wants the repaired note made ready for a static host, run:

```bash
node <skill-dir>/scripts/audit.mjs note publish <html-file|directory|zip> \
  [--entry <exact-relative-html>] \
  [--output <evidence-root>] \
  [--browser <chrome-or-edge-path>]
```

An installed Skill copy intentionally contains no vendored `node_modules`. If local `playwright-core` resolution is unavailable, invoke the version-pinned GitHub package instead:

```bash
npx --yes --package="github:KevinwithPanda/RealityHTMLCheck#v0.11.0" \
  realityhtmlcheck publish <html-file|directory|zip>
```

This is still a direct Skill workflow; the user does not copy a prompt into a second Codex task. Do not call `--static-only` a substitute for the requested real-browser proof.

Use the repaired working folder from the agentic workflow when repairs were requested; otherwise the command freezes a new output candidate without changing the source. The authoritative publish flow must:

1. inventory the complete disk or ZIP scope and reject symlinks, special files, likely secrets/development trees, unsafe/colliding paths, damaged ZIP records, or configured byte/file ceilings;
2. require exact lowercase root `index.html`, use the sole HTML page, or require an explicit `--entry`; a non-root entry receives a generated no-JavaScript gateway, while an existing root entry is never overwritten;
3. apply only safe metadata changes plus source-offset-verified, non-overlapping case/backslash reference repairs whose target is unique; preserve query strings and fragments, and never guess a missing, ambiguous, escaped, percent-encoded, remote, or dynamic path;
4. rerun the complete note/package analysis and block error findings, remote runtime dependencies, missing mobile viewport, unreadable package content, active HTML/SVG/code, server runtimes, and the reserved public proof path;
5. bind the sorted path/size/SHA-256 deploy bytes, build a deterministic STORE ZIP, read it back, and navigate only those exact bytes through a loopback server;
6. require desktop, 375px mobile, root mount, `/project/` mount, true `offline: true` exact-byte replay, every bounded HTML page, local fragment, response hash, console/page error, failed/HTTP request, overflow, external/unknown request, popup/dialog/download/worker/WebSocket, and truncation gates to pass with JavaScript disabled;
7. add only a source-free bilingual public proof under `realitycheck-proof/`, rebuild/read back the final ZIP, rerun the browser proof against its exact container, and bind the container SHA-256 with the adjacent sidecar/receipt.
8. run `node <skill-dir>/scripts/audit.mjs validate <publish-run-directory>` and require every discovered note/publish JSON plus the receipt's sibling ZIP/sidecar/proof bindings to pass before reporting completion.

Only `ready` or `warnings` with every required browser gate complete may use `*.realitycheck-publish.zip`. `browser-proof-required` and `working-copy` must use `*.realitycheck-working-copy.zip` and exit nonzero. Report the archive, `.sha256`, receipt, public report, local `technical-report.json`, repair plan, platform-specific decisions, applied changes, and blockers. A successful local result means no blocker was found for the declared passive Chromium scenarios; it does not mean the file was uploaded, that a host account/quota/domain/CDN is valid, or that malware, secrets, facts, copyright, comprehensive accessibility/SEO, every browser, dynamic behavior, backend features, or PWA offline behavior were certified. Netlify Drop and Cloudflare Direct Upload can consume a successful ZIP/folder within their current limits; GitHub Pages requires extraction into a publishing source or directory deployment through Actions.

## Automate one exact publish run in GitHub Actions

When the user wants a repeatable export pipeline rather than a local one-off command, use the Composite Action:

```yaml
- uses: KevinwithPanda/RealityHTMLCheck@v0.11.0
  id: realitycheck
  with:
    kind: publish
    path: exported-site
    # entry: notes/home.html  # only when no unambiguous root entry exists
    artifact-name: verified-html-publish-capsule
```

The Action installs its pinned adapter, runs the same two-stage exact-byte Chromium proof, parses the CLI's create-only structured result, revalidates the complete run, uploads only that exact timestamped directory, then enforces exit `0/1/2`. Use its `publish-ready`, `publish-archive-path`, `publish-working-copy-path`, `publish-archive-sha256`, and `publish-deploy-content-id` outputs in downstream read-only logic. Never parse console text or scan an output root for the newest directory.

Keep these boundaries explicit:

- `upload-artifact: true` uploads the complete HTML, images, styles, and attachments to GitHub Artifact storage; it is not the zero-upload browser/CLI privacy model. Review repository visibility and retention, or set it to `false`.
- The Action never deploys, never requests `pages: write` / `id-token: write`, and never receives a Netlify or Cloudflare token.
- Publish input and output must be separate, non-nested workspace locations; do not use checkout root `path: .` because it normally contains `.git` and unrelated files.
- A valid blocked result exits `1` only after its exact working copy and diagnosis are preserved. Result parsing, cross-artifact validation, dependency, or requested upload failure is operational exit `2`.
- GitHub Artifact digest and the capsule ZIP SHA-256 are different identities; never substitute one for the other.

Use the checked-in `examples/github-actions/verified-publish.yml` as the copy-ready workflow. If a separate downstream job later deploys the verified bytes, that job owns its permissions, environment approval, account and host-side verification; the RealityCheck Action itself remains a read/check/package boundary.

## Complete an agentic repair

When the user invokes the Skill with an explicit request to check and repair a bounded note or folder, perform the handoff inside the same Codex task. The user does not need to copy the report prompt back into Codex.

1. Run `node <skill-dir>/scripts/note-check.mjs <file-or-directory> --prepare-repair`. Preserve the initial run as before evidence.
2. Use the emitted `repaired` folder, which preserves the bounded relative note-and-asset structure and applies safe metadata fixes. Treat the request as authorization to edit that copy, not the supplied source.
3. Inspect each remaining finding and its source context, and make only high-confidence changes whose intended result can be established from the note folder.
4. Rerun the same note command against the repaired folder with the immutable before `report.json` passed as `--baseline`; retain the separate after report plus `comparison.html` and `comparison.json`.
5. Return both reports, both comparison artifacts, the repaired entry HTML or folder, the change summary, and unresolved decisions.

Do not claim the repaired output is complete when an attachment is unavailable, a factual description would need to be invented, or the after report still contains errors. A remaining warning may be acceptable for use only when it is disclosed and does not break the user's stated sharing target.

## Completion

Report the checked file count, score, error/warning counts, report path, and whether any repaired copies were created. State that content was not uploaded and originals were not modified. If the user asks whether facts or citations are true, treat that as a separate source-verification task rather than claiming the HTML check covered it.
