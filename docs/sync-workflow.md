# Sync workflow

The publisher's only workflow is `.github/workflows/sync-standards.yml`. It
runs `scripts/vendor-standards.mjs` to fan out a new version of
`standards/*.md` to every consumer repo.

This page is a job-by-job walkthrough — what each step does, why it exists,
and what it produces. For *why* this design (fail-loud, no auto-merge, etc.)
see [`drift-detection.md`](./drift-detection.md) and the repo's
[`core-principles.md`](../standards/core-principles.md).

## Trigger

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'standards/**'
```

The workflow fires on **pushes to `main` that change files under
`standards/`**. A push that only touches `scripts/`, `.github/`, or
`README.md` does **not** trigger a sync — those don't change what gets
vendored. A tag push does not trigger it; a `workflow_dispatch` is not wired
up; PRs to `main` do not trigger it (the push from the merge does).

The vendor script is also runnable by hand from inside the repo:

```bash
node scripts/vendor-standards.mjs                  # open PRs on every consumer
node scripts/vendor-standards.mjs --local /tmp/v   # write to /tmp/v for inspection
```

The `--local` mode skips all git operations and just writes the vendored
files. Useful for previewing what would change without spinning up CI.

## Jobs

The workflow has one job: `sync-standards`. All steps run on
`ubuntu-latest` (the vendoring script is pure Node — Linux, macOS, and
Windows would all work the same; ubuntu is chosen because every other
Action runs there and the runner image is already cached).

### Step 1 — Checkout standards

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 1
    token: ${{ secrets.GITHUB_TOKEN }}
```

Shallow clone is fine — the script only needs `HEAD` for the SHA it bakes
into each sync header. No tags, no history.

### Step 2 — Vendor standards + open PRs in each consumer repo

```yaml
env:
  GH_TOKEN: ${{ secrets.STANDARDS_SYNC_TOKEN }}
run: node scripts/vendor-standards.mjs
```

This is the load-bearing step. The script:

1. Resolves `gitHeadShort()` from `n3ary/standards@HEAD` — the SHA that goes
   into every vendored file's sync header.
2. Iterates the `CONSUMERS` array (an in-source list — see the script for
   the canonical list of consumer repos and their per-repo `vendorDir`).
3. For each consumer:
   - Clones the repo to `/tmp/vendor-<repo>-<sha>` at depth 1.
   - Creates a new branch `chore/vendor-standards-<sha>`.
   - Walks `standards/*.md`, skipping `README.md` and `SHARED-STANDARDS.md`
     (manifest + index stay canonical-only) and any file in the consumer's
     `skip` set (e.g. `feed-agnostic.md` on `n3ary/app`, which is a
     app-specific doc that lives in `docs/standards/` because the renderer
     looks there, but isn't actually a shared rule).
   - Computes the new file content: sync header + the canonical body.
   - Compares against the existing file. If identical, skip — this is what
     stops the workflow from churning consumer PRs when the publisher only
     touched files that consumer doesn't import.
   - If anything changed: commit on the local branch, push, open a PR via
     `gh pr create --repo <consumer> --base main --head chore/vendor-standards-<sha>`.
4. Cleans up the temp clone. Failures in one consumer do not abort the
   others — each consumer is wrapped in its own try/catch so a single broken
   clone can't poison the rest of the run.

### Step 3 — Summary

```yaml
- name: Summary
  if: always()
  run: |
    echo "## Standards sync" >> $GITHUB_STEP_SUMMARY
    ...
```

Writes a short summary table to `$GITHUB_STEP_SUMMARY` so the run page
shows what happened at a glance. The script already prints
`[<consumer>] opened PR: <url>` to stdout for each consumer it touched;
this step just makes that visible in the Actions UI.

## Permissions

```yaml
permissions:
  contents: read
```

The workflow needs no extra permissions on `n3ary/standards` itself — the
checkout is `contents: read`. The cross-repo push + PR creation requires the
`STANDARDS_SYNC_TOKEN` secret described in [`architecture.md`](./architecture.md#auth-model).

## Outputs

Per consumer, on every run:

| State | Output |
| --- | --- |
| Canonical changed something the consumer imports | One PR opened in the consumer (`chore/vendor-standards-<sha>` branch → `main`). Step stdout prints the PR URL. |
| Canonical changed only `README.md` / `SHARED-STANDARDS.md` / skipped files | No PR — consumer already has what it needs. |
| Canonical didn't change anything new vs the consumer's last vendored copy | No PR — short-circuits in the script: `[<consumer>] up-to-date, skipping`. |
| Clone / push / PR fails for a single consumer | Error logged for that consumer, the loop continues, other consumers still get their PRs. The workflow step exit code is whatever the script returns; failures are visible in the summary. |

## What this workflow is *not*

- **Not an auto-merge.** It opens PRs; humans merge them. Branch protection
  on each consumer requires a PR for every commit to `main`, so this is the
  only shape the workflow can take.
- **Not a polling webhooks consumer.** It runs on push. The drift check on
  the consumer side runs on PR. Together they cover "publisher changed"
  (this workflow) and "consumer PR might be stale" (drift check).
- **Not idempotent across re-runs.** A re-run does no harm — the script
  compares content before committing — but you'd typically just wait for the
  original run to finish.
- **Not the only place `docs/standards/` gets written.** Consumers can run
  `node scripts/vendor-standards.mjs --local` (or fork the vendor-standards
  script) to seed the directory for the first time, before the workflow has
  ever fired for them. The sync header is what makes the drift check happy
  either way.
