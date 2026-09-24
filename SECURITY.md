# Security policy

## Reporting a vulnerability

Report a vulnerability privately through [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for this repository when available, or contact the JevForge maintainers through a private channel.

**Do not** open a public issue that includes tokens, endpoints that receive credentials, or a working exploit.

## Threat model

Pathfinder reads a diff and a job allowlist, asks Jev for a typed selection, and publishes job ids. Useful attacks include forcing the Action to skip a check, leak a credential, or treat model text as a command.

Controls:

* Jev text is not interpolated into a shell, a workflow file, or a GitHub API call.
* Job ids and reason codes come from closed enums and the configured allowlist.
* `run_jobs` and `skip_jobs` are complements of that allowlist.
* Step scripts in GitHub Actions, CircleCI, and Jenkins files are not parsed into the Jev payload.
* Secrets are read from environment variables and redacted if they appear in an error string.
* A repository-controlled `jev_endpoint` does not receive credentials unless `trust_repo_jev_endpoint` is explicitly true.
* Private, loopback, and link-local endpoint hosts are rejected.

## Residual risk

A pull request can still edit `.jev/ci-pathfinder.yml` and widen or narrow the allowlist. Protect that file with CODEOWNERS. A public DNS name that later resolves to an internal address can still receive a request if a workflow author set that endpoint as an Action input.

The Action does not rewrite workflows. Skipping a job still has product impact, which is why an untrusted Jev result runs the full allowlist under the default `warn` policy instead of skipping checks.

## Supported versions

Security fixes apply to the latest published `0.x` release. Prefer pinning to a release tag or commit SHA you have reviewed.
