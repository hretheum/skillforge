# Security Policy

## Supported versions

Pre-1.0 release. Only the latest commit on `main` receives security fixes. No LTS branches yet.

## Reporting a vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Use **[GitHub Security Advisories](../../security/advisories/new)** to report privately.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**SLA:**

- Acknowledgement within 48 hours
- Critical vulnerabilities: fix within 7 days
- Non-critical: fix in the next release
- Reporter credited in the release notes (unless they prefer anonymity)

## Scope

**In scope:**

- Credential leaks via secret-scan bypass (`docs/11-security-and-secrets.md`)
- Prompt injection via untrusted input through the inbound guard
- Unauthorized access via adapter compromise
- Authorization bypass in tool-governance (`docs/13-tool-governance.md`)
- Code execution via malicious skill or MCP connector

**Out of scope:**

- General security advice or hardening suggestions
- Vulnerabilities in upstream dependencies (please report to the upstream project)
- Social engineering attacks
- Vulnerabilities in client systems using skillforge

## Security model

skillforge's threat model is documented in `docs/11-security-and-secrets.md` and `docs/13-tool-governance.md`. Key controls:

- **Secret-scan gate**: credential-shaped values are blocked before reaching any Write/Send tool
- **Tool governance**: per-skill `requiredTools` list; out-of-scope tool calls are denied at the PreToolUse hook
- **Clean-room rule**: the one-way membrane prevents supply-chain risks from upstream code
- **MCP connector policy**: per-client allowlist; unknown connectors are denied fail-closed

## License note

skillforge is licensed under Apache 2.0 + Commons Clause. Security researchers are welcome to study the code under these terms.
