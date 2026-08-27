# Security policy

## Supported versions

The latest `0.12.x` release receives security fixes while the project is in Beta.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. If private reporting is unavailable, open a public issue requesting a private maintainer contact without including exploit details, target data, tokens, screenshots, or reproduction secrets.

Do not publicly disclose a vulnerability until maintainers have assessed its impact and coordinated a fix.

## High-priority security issues

- browser automation that can trigger destructive business actions;
- bypasses of local/private target restrictions;
- secret leakage through URLs, console output, network evidence, screenshots, or reports;
- evidence path traversal or writes outside the run directory;
- ZIP import traversal, decompression bombs, hidden/overlapping records, encrypted or special-file entries, sensitive-file bundling, and source/content/proof identity mismatches;
- HTML/Markdown injection from hostile page content;
- silent browser or dependency installation;
- audit mode modifying application source;
- one scenario leaking cookies, routes, storage, or mutations into another.
- authenticated storage-state paths or values leaking into an artifact;
- same-origin discovery escaping route exclusions or triggering a business action;
- declarative project configuration being interpreted as executable code.
- live-deployment verification sending credentials, leaving the authorized origin/base path, retaining response bodies or raw headers, or promoting partial/non-HTTPS coverage to a match;
- materialization deploying an original, tampered, symlinked, partial, or non-publish-ready tree instead of the validated capsule bytes;
- Pages/OIDC permission leaking from the dedicated deployment job into the core check/package Action.

## Intended boundary

RealityCheck is for applications the user owns or is authorized to test. Its crawler is a bounded same-origin link discovery mechanism, not a general crawler, penetration-testing framework, credential manager, or production monitoring service.

Reports can contain sensitive UI screenshots even after textual redaction. Review artifacts before sharing them and never attach a private report to a public issue without explicit approval.

`verify-deploy` is a bounded point-in-time check of an explicitly authorized live base URL. It sends credential-free same-origin GETs, stores hashes and controlled response facts rather than bodies or raw headers, and saves two local screenshots only when live browser proof runs. It does not log into a host, verify account ownership, manage DNS/custom domains, continuously monitor availability, or roll back a deployment.

The visual report scripts are limited to local language switching and clipboard preparation. They do not fetch remote code or send report content over the network. A generated fix-and-verification task is not executed by the report: the user must explicitly submit it to Codex before any source edit is authorized.
