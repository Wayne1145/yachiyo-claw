# Security Policy

## Supported versions

Yachiyo Claw is an early-preview project. Security fixes are provided for the latest release on a
best-effort basis; older APKs and unofficial forks are not supported. Reproduce a report on the latest
release or current `main` branch when possible.

## Reporting a vulnerability

Use a private [GitHub Security Advisory](https://github.com/Wayne1145/yachiyo-claw/security/advisories/new)
for vulnerabilities that can expose credentials or private data, bypass Agent approval, escape plugin
or workspace boundaries, execute code without consent, forge updates, or compromise another app or
device. Do not open a public issue until a fix or coordinated disclosure is available.

Include:

- affected version, Android version, ABI, WebView version, and root/Shizuku/accessibility state;
- exact prerequisites and a minimal reproduction;
- the expected and observed trust-boundary transition;
- logs with credentials, tokens, conversation text, file contents, screenshots, and personal data
  removed;
- whether the issue works in a release build or requires USB debugging/root.

Please do not test against another person's account or device, cause irreversible external actions,
publish working exploits before coordination, or retain data obtained during testing. The maintainers
will acknowledge complete reports when available, but this community project does not promise a fixed
response or bounty schedule.

## Security model

Model output is untrusted input, not authorization. Shell, accessibility, Shizuku, root, plugin, MCP,
file, and device actions must pass through typed contracts, the Tool Broker, policy checks, and an audit
layer. Dangerous or externally visible actions require parameter-bound approval by default.

The detailed threat model, approval invariants, prompt-injection rules, background execution model,
and known limits are documented in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md). Plugin-specific
boundaries and residual risks are documented in
[docs/plugin-platform/security-review.md](docs/plugin-platform/security-review.md).

Important limits:

- PRoot is a compatibility environment, not a kernel container or virtual machine.
- Rooted devices and compromised system WebView/firmware can bypass application-level guarantees.
- Accessibility observations, web pages, model output, Skills, MCP responses, and plugins are all
  potentially hostile.
- Unsigned plugins cannot receive the `device` capability. A Linux sandbox grant remains high risk
  because code can access the shared PRoot image and make network connections.
- Local and cloud models can hallucinate, loop, or misunderstand screen state. Approval and observable
  post-action verification remain necessary for consequential work.

## Release integrity

Install APKs only from the project's
[GitHub Releases](https://github.com/Wayne1145/yachiyo-claw/releases). Verify the published SHA-256
sidecar, and do not accept an Android update that reports a different package or signing identity.
Release signing keys, API keys, marketplace private keys, and OAuth client secrets must never be
committed to the repository or included in diagnostics.
