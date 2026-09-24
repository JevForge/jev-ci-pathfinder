# Changelog

## [Unreleased]

### Changed

* Professional README structure (features, demo, auth, troubleshooting, versioning).
* Clearer Action metadata description for Marketplace (≤125 characters).
* Prefixed runtime errors and warnings with `[JEV CI Pathfinder]`.
* Expanded CONTRIBUTING and SECURITY guidance.
* Added `examples/basic.yml` and `examples/pr.yml`.

## 0.1.1

Shorten the Marketplace `action.yml` description to stay under the 125-character limit.

## 0.1.0

Initial JEV CI Pathfinder action.

* Typed Jev selection of allowlisted jobs through `vercel-ai-gateway`, `typesafe-native`, and `custom-compatible`.
* Deterministic executor for allowlists, path hits, always-on jobs, dependency closure, history reruns, and monorepo plans.
* Read-only inventory for GitHub Actions, CircleCI, and Jenkins.
* Low-confidence policies `fail`, `warn`, `request-review`, and `no-op`.
