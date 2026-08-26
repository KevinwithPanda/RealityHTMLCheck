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

## Complete an agentic repair

When the user invokes the Skill with an explicit request to check and repair a bounded note or folder, perform the handoff inside the same Codex task. The user does not need to copy the report prompt back into Codex.

1. Run `node <skill-dir>/scripts/note-check.mjs <file-or-directory> --prepare-repair`. Preserve the initial run as before evidence.
2. Use the emitted `repaired` folder, which preserves the bounded relative note-and-asset structure and applies safe metadata fixes. Treat the request as authorization to edit that copy, not the supplied source.
3. Inspect each remaining finding and its source context, and make only high-confidence changes whose intended result can be established from the note folder.
4. Rerun the same note command against the repaired folder and retain a separate after report.
5. Return both reports, the repaired entry HTML or folder, the change summary, and unresolved decisions.

Do not claim the repaired output is complete when an attachment is unavailable, a factual description would need to be invented, or the after report still contains errors. A remaining warning may be acceptable for use only when it is disclosed and does not break the user's stated sharing target.

## Completion

Report the checked file count, score, error/warning counts, report path, and whether any repaired copies were created. State that content was not uploaded and originals were not modified. If the user asks whether facts or citations are true, treat that as a separate source-verification task rather than claiming the HTML check covered it.
