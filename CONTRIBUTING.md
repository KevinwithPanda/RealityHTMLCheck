# Contributing

Thanks for helping RealityCheck make browser audits more trustworthy.

By participating, you agree to follow the [community code of conduct](CODE_OF_CONDUCT.md). For installation and usage questions, start with [SUPPORT.md](SUPPORT.md); security reports follow [SECURITY.md](SECURITY.md).

## Before starting

1. Search existing issues and the roadmap.
2. Open a structured issue for a new default scenario, detector, report contract change, or browser adapter.
3. Keep changes bounded. A scenario, detector, renderer, and adapter are separate review surfaces.

Use Python 3.11 or newer for local tooling.

## Development checks

```bash
python -m unittest discover -s tests -v
npm test
npm run realitycheck -- validate examples/reference-run/report.json
python realitycheck/scripts/report.py validate examples/reference-run/report.json --fail-on critical
python /path/to/skill-creator/scripts/quick_validate.py realitycheck
```

The last command uses the skill validator bundled with Codex when available.

## Contribution standards

### Skill instructions

- Keep `SKILL.md` focused on the core workflow and under 500 lines.
- Put detailed procedures in a directly linked reference file.
- Keep triggering language accurate; do not claim support that lacks an end-to-end test.
- Preserve audit-only behavior unless the user explicitly requests a scoped fix.

### Scenarios

A new scenario must document:

- the user problem it exposes;
- the exact capability it requires;
- deterministic setup and a fixed runtime budget;
- mutations and safe exclusions;
- positive and negative fixtures;
- measurements that distinguish a finding from an opinion;
- fallback, skipped, and unsupported behavior;
- cleanup and isolation requirements.

Do not add automatic business-action clicks, form submissions, public-target defaults, unbounded crawling, or random monkey testing.

### Detectors

- Compare with baseline before reporting scenario-induced defects.
- Use stable selectors and bounded scans.
- Keep low-confidence heuristics out of score and CI thresholds.
- Add regression coverage for false positives.
- Never persist secrets, full response bodies, or unbounded page content.

### Report contract

- Update tests, `report-schema.md`, and every affected schema under `realitycheck/assets` together.
- Validate page, verification, site, and trend artifacts with `realitycheck validate` before review.
- Change `schemaVersion` for an incompatible machine-readable change.
- Keep scoring deterministic and test cap order explicitly.
- Preserve exit-code semantics.

## Pull requests

Keep the PR description evidence-based:

- problem and scope;
- files and behavior changed;
- commands and exact results;
- screenshots or report fragments when browser behavior changes;
- safety or compatibility impact;
- remaining limitations.

Do not commit `.realitycheck/` runs containing private application evidence. Use the intentionally broken demo for public fixtures.
