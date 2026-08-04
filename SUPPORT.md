# Support

RealityCheck is a Beta open-source project. The fastest way to get useful help is to share the smallest safe reproduction and the exact artifact that failed.

## Choose the right route

- Use the **bug report** template when a documented command crashes, writes invalid evidence, or reports a reproducible false positive.
- Use the **scenario proposal** template when an important browser stress state is missing.
- Use the **browser adapter** template when Chrome, Edge, or another supported runtime cannot be discovered or controlled.
- Use the **configuration question** template when a project policy is valid but does not express the control you need.
- Follow [SECURITY.md](SECURITY.md) for vulnerabilities. Never put exploit details, credentials, private URLs, screenshots, or customer evidence in a public issue.

## Include this evidence

1. RealityCheck version, operating system, Node version, Python version, and browser name/version.
2. The exact command and exit code.
3. The smallest synthetic or public fixture that reproduces the behavior.
4. The relevant rule ID, scenario ID, and safe report fragment.
5. Whether the behavior reproduces with the bundled demo.

Do not attach a private `.realitycheck` directory wholesale. Reports can contain application screenshots even when text and URLs are redacted.

## Scope

Maintainers can help with RealityCheck installation, configuration, evidence contracts, built-in scenarios, adapters, and reproducible detector behavior. They cannot authorize testing of a site you do not own, review private customer data, guarantee regulatory compliance, or debug unrelated application code without a minimal reproduction.

Feature requests are evaluated against the roadmap, safety boundary, deterministic-test requirement, and maintenance cost. A request may be useful and still remain unsupported until it has a conservative detector and paired positive/negative fixtures.
