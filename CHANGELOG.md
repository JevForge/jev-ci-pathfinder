# Changelog

## 0.3.2

### Added

* `comment_on_github` input (default `false`) upserts an idempotent PR comment marked `<!-- jev-ci-pathfinder -->` with the run/skip table and provisional flag. Requires `pull-requests: write`.

## 0.3.1

### Added

* History API prefers allowlisted job ids; optional `history_job_id_map` (JSON name→id) maps GitHub Actions display names to config job ids. Unmapped/non-allowlisted names are dropped.

## 0.3.0

### Added

* Monorepo Navigator contract `plan_version: 1` (legacy plans without a version remain accepted). See `docs/monorepo-plan.md`.

## 0.2.4

### Added

* `examples/CODEOWNERS` and `examples/branch-protection.md` to protect `.jev/ci-pathfinder.yml` from silent allowlist edits.

## 0.2.3

### Added

* `if_snippets` output (JSON map of job id → suggested `if:` expression) and Job Summary snippets. Documents that CSV `contains` can match job id prefixes.

## 0.2.2

### Added

* `matrix` output shaped as `{"include":[{"job":"<id>"},...]}` for `strategy.matrix` consumers.

## 0.2.1

### Added

* `cache_decisions` input (default `false`) restores/saves the typed decision via the GitHub Actions cache. Keyed by commit SHA, config fingerprint, paths, provider, and `decision_mode`. Output `cache_hit` reports whether the cache was used.

## 0.2.0

### Added

* `decision_mode` input: `jev` (default) or `deterministic`. Deterministic mode selects jobs from path hits, always-on flags, history reruns, and authoritative monorepo mappings without calling Jev (`DETERMINISTIC_ONLY`, `provisional=true`).

## 0.1.2

### Changed

* Professional README structure (features, demo, auth, troubleshooting, versioning).
* Clearer Action metadata description for Marketplace (≤125 characters).
* Prefixed runtime errors and warnings with `[JEV CI Pathfinder]`.
* Expanded CONTRIBUTING and SECURITY guidance.
* Added `examples/basic.yml` and `examples/pr.yml`.
* Aligned Release workflow with `jev-model-navigator` (publish release inside `workflow_dispatch`).

## 0.1.1

Shorten the Marketplace `action.yml` description to stay under the 125-character limit.

## 0.1.0

Initial JEV CI Pathfinder action.

* Typed Jev selection of allowlisted jobs through `vercel-ai-gateway`, `typesafe-native`, and `custom-compatible`.
* Deterministic executor for allowlists, path hits, always-on jobs, dependency closure, history reruns, and monorepo plans.
* Read-only inventory for GitHub Actions, CircleCI, and Jenkins.
* Low-confidence policies `fail`, `warn`, `request-review`, and `no-op`.
