# Security policy

## Supported versions

Security fixes are provided for the latest release. Older releases may not
receive a fix; upgrade before reporting an issue that may already be fixed.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting at
<https://github.com/Jacob-Chamney/LockedIn-Tui/security/advisories/new>.
Include the affected version, platform, terminal, the smallest reproduction and
the impact you believe it has.

Do not include API keys, tokens, workspace contents or other personal data.
Redact logs before attaching them.

## Scope

In scope: the application, the install instructions, update checks and binary
replacement, secret handling in the OS keychain, path confinement, plugin
sandboxing and command approval.

Out of scope: third-party terminals, operating systems, model providers, MCP
servers, or forks that change the binary.
