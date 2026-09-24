# Contributing

Issues and pull requests are welcome. Please describe the CI decision you expected, the config you used, and the `decision`, `reason_codes`, and `provisional` outputs you observed. Do not include tokens.

## Local checks

```bash
npm ci
npm run all
```

`npm run all` must pass before a change is merged. Commit the rebuilt `dist/index.js` and `dist/package.json` when source that feeds the bundle changes. The CI workflow fails if the bundle is stale.

## Contracts

Do not add a provider fallback. Do not execute `summary`, path text, or model prose. New reason codes and outputs are a contract change and need a changelog entry. Keep the Vercel adapter behind `JevProvider`, and keep it on `experimental_evaluate` rather than `generateText`.

## License

By contributing, you agree that your contribution is licensed under the MIT license in this repository.
