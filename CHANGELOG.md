# Changelog

## 0.1.1

Shorten the Marketplace `action.yml` description to 89 characters (GitHub limit 125).

## 0.1.0

Initial JEV CI Pathfinder action.

- Typed Jev selection of allowlisted jobs through `vercel-ai-gateway`, `typesafe-native`, and `custom-compatible`.
- Deterministic executor for allowlists, path hits, always-on jobs, dependency closure, history reruns, and monorepo plans.
- Read-only inventory for GitHub Actions, CircleCI, and Jenkins.
- Low-confidence policies `fail`, `warn`, `request-review`, and `no-op`.
