# Changelog

## 0.4.3

### Added

* Composite wrapper at `composite/action.yml`: `actions/checkout@v4` + Pathfinder with re-exported outputs. Use `JevForge/jev-ci-pathfinder/composite@v0`.

## 0.4.2

### Added

* Marketplace/docs visual: `docs/assets/pathfinder-flow.svg` embedded in the README flow section.

## 0.4.1

### Added

* `telemetry` input (default `false`) emits a structured JSON info log with `duration_ms`, `provider`, `provisional`, `run_count`, `cache_hit`, `decision`, and `decision_mode` — never paths or secrets.

## 0.4.0

### Changed

* Extracted `JevProvider` / `EvaluationRequest` / `JevProviderOptions` into `src/jev/contract.ts`. Adapters import from that module in preparation for swapping to `@jevforge/core` when published (no new npm dependency).

## 0.3.4

### Changed

* **Semantic `dry_run`:** default `true` still emits all outputs and the Job Summary, but no longer calls `setFailed` when policy is `fail`. Set `dry_run: false` to fail the step on policy fail (previous behavior for fail paths). Workflows are still never edited.

## 0.3.3

### Added

* `create_check_run` input (default `false`) creates a completed Check Run named “JEV CI Pathfinder” with conclusion aligned to policy/`decision`. Requires `checks: write`.

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
