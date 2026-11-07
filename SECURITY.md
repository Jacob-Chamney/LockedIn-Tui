# Security policy

## Supported versions

Security fixes are provided for the latest 1.x release. Older releases may not
receive a fix; upgrade to the latest release before reporting an issue that may
already be fixed.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting at
<https://github.com/Jacob-Chamney/LockedIn-Tui/security/advisories/new>:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version (`lockedin --version`), platform and terminal,
   the smallest reproduction you can, and the impact you believe it has.

If private reporting is unavailable, open a discussion asking for a private
channel without including exploit details.

Please do not include API keys, tokens, workspace contents or other personal
data. Redact logs before attaching them.

## What to expect

Reports are acknowledged on a best-effort basis. There is no bug bounty and no
guaranteed response time. Confirmed issues are fixed in the next release, and
the release notes describe the user-visible impact without publishing an exploit
before users can upgrade.

## Scope

In scope: the released binaries, the install instructions, the update check and
binary replacement, and the handling of secrets in the OS keychain.

Out of scope: vulnerabilities in third-party terminals, operating systems, model
providers, or forks that change the binary.
