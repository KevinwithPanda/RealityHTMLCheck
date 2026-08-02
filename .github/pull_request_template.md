## Problem and scope

<!-- What is wrong or missing, and what is intentionally outside this PR? -->

## Behavior changed

<!-- Describe observable skill, browser, report, or documentation behavior. -->

## Evidence

<!-- Commands, results, small report fragments, or safe demo screenshots. -->

## Safety and compatibility

- [ ] Audit mode remains read-only.
- [ ] Remote targets still require explicit authorization.
- [ ] User-controlled output is redacted, truncated, and safely rendered.
- [ ] Unsupported checks are not reported as passed.
- [ ] Report/schema changes are versioned and tested.

## Validation

- [ ] `python -m unittest discover -s tests -v`
- [ ] Reference report validation
- [ ] Codex skill validation when available

## Remaining limitations

<!-- Be explicit. "None" is acceptable only after review. -->
