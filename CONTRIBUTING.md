# Contributing

Thanks for helping improve JEV CI Pathfinder. Please describe the CI decision you expected, the config you used, and the `decision`, `reason_codes`, and `provisional` outputs you observed. **Do not include API keys, tokens, or other secrets.**

## Setup

```bash
git clone https://github.com/JevForge/jev-ci-pathfinder.git
cd jev-ci-pathfinder
npm ci
```

Requires Node.js 24+.

## Local checks

```bash
npm run typecheck
npm test
npm run build
# or everything:
npm run all
```

`npm run all` must pass before a change is merged. Rebuild and commit `dist/index.js` (and `dist/package.json`) when source that feeds the bundle changes. CI fails if the bundle is stale.

## Pull requests

Use the PR template checklist:

* Code tested locally
* Documentation updated (README / CHANGELOG / examples)
* No secrets committed
* Public inputs/outputs remain compatible (or the breaking change is called out)
* `dist/` rebuilt when needed

## Contracts

* Do not add a silent provider fallback.
* Do not execute `summary`, path text, or model prose.
* New reason codes and outputs are a public contract change — update CHANGELOG and README.
* Keep the Vercel adapter behind `JevProvider` and on `experimental_evaluate` (not `generateText`).

## Issues

* Bugs: use the bug report template (include Action version and redacted logs).
* Features: describe the problem and the expected workflow behavior.

## License

By contributing, you agree that your contribution is licensed under the MIT license in this repository.
