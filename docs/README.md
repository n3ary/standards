# docs/

Architecture documentation for `n3ary/standards` and the org-wide sync machinery
that this repo owns.

These pages explain **how the system works** — the shape of the sync workflow,
how drift is detected, and how a consumer repo joins the pool. They are not the
canonical rules; the canonical rules live in [`standards/`](../standards/) (the
files that get vendored into every consumer).

## What's here

| File | Covers |
| --- | --- |
| [`architecture.md`](./architecture.md) | System overview — the cast of repos, who publishes, who consumes, end-to-end vendor round-trip. |
| [`sync-workflow.md`](./sync-workflow.md) | Job-by-job walkthrough of `.github/workflows/sync-standards.yml` — the canonical standards publisher. |
| [`drift-detection.md`](./drift-detection.md) | How drift is detected in a consumer's `docs/standards/*`, plus the auto-fix path that brings a consumer back in sync. |
| [`consumer-integration.md`](./consumer-integration.md) | How to onboard a new repo as a standards consumer (register it, mirror the drift check, mirror the ignore paths). |

## Reading order

1. `architecture.md` — the map.
2. `sync-workflow.md` — what the publisher does on each run.
3. `drift-detection.md` — what the consumer checks on each PR, and how the publisher fixes drift automatically.
4. `consumer-integration.md` — only when you're adding a new repo to the consumer list.

## Scope

These docs are about **plumbing** (workflows, scheduling, auth, the PR
handshake). They don't restate what any individual standard says — for the
content of each rule, read [`standards/`](../standards/) directly.

If the code in `.github/workflows/sync-standards.yml` or
`scripts/vendor-standards.mjs` disagrees with anything in this folder, the code
wins; fix the doc.
