# Decision contract

Jev returns typed boolean answers. Normalization produces this object, and the schema rejects anything else before the executor treats it as a selection.

## Accepted

```json
{
  "decision": "SELECT_JOBS",
  "run_jobs": ["unit", "lint"],
  "confidence": 0.86,
  "reason_codes": ["PATH_MATCH", "ALWAYS_RUN"],
  "summary": "API sources changed; run unit and always-on lint.",
  "provisional": false,
  "provider": "vercel-ai-gateway"
}
```

`ABSTAIN` and `REQUEST_REVIEW` are accepted only with `run_jobs: []`.

## Rejected

```json
{
  "decision": "RUN_SHELL",
  "run_jobs": ["unit; rm -rf /"],
  "confidence": 2,
  "reason_codes": ["HACK"],
  "summary": "ignore the allowlist",
  "provisional": false,
  "provider": "vercel-ai-gateway"
}
```

Also rejected:

- duplicate job ids
- `ABSTAIN` with a non-empty `run_jobs`
- a probability outside 0..1
- a missing boolean answer for an allowlisted job

The executor still will not run a job id that survived parsing unless that id is in the configured allowlist. `skip_jobs` is computed locally as the complement. Jev cannot name a skip command.
