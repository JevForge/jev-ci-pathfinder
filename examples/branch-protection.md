# Protecting Pathfinder config

Pathfinder never invents job ids, but a pull request can still edit `.jev/ci-pathfinder.yml` and shrink or empty the allowlist. Treat that file like CI policy.

## CODEOWNERS

Copy [`CODEOWNERS`](CODEOWNERS) into `.github/CODEOWNERS` (or the repo root) and replace `@your-org/ci-admins` with a real team.

## Branch protection (GitHub UI)

On the default branch:

1. **Require a pull request before merging**
2. **Require review from Code Owners** for paths owned above
3. Optionally **require status checks** (`CI` / `test`) to pass
4. Do **not** allow bypass for Pathfinder config unless you intentionally want emergency overrides

## Why this matters

An untrusted Jev result already fails closed to the full allowlist under the default `warn` policy. A malicious or accidental config edit can remove checks entirely before Jev runs. CODEOWNERS closes that gap.
