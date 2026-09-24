# Monorepo Navigator hand-off (plan_version 1)

Pathfinder accepts a JSON `monorepo_plan` from JEV Monorepo Navigator.

## Contract v1

```json
{
  "plan_version": 1,
  "affected_projects": ["web"],
  "execution_plan": [
    { "project": "web", "jobs": ["unit", "lint"] }
  ]
}
```

Rules:

* `plan_version` must be `1` when present.
* Legacy plans **without** `plan_version` remain accepted for compatibility.
* Job ids outside the Pathfinder allowlist are dropped (`MONOREPO_JOB_DROPPED`).
* With `monorepo_authoritative: true`, mapped allowlisted jobs are forced into `run_jobs`.

## Consumer example

```yaml
- id: plan
  uses: JevForge/jev-ci-pathfinder@v0
  with:
    monorepo_plan: ${{ needs.mono.outputs.plan }}
    monorepo_authoritative: 'true'
```
