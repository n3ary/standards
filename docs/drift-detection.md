# Drift detection

Every consumer repo carries a copy of the standards in `docs/standards/*.md`.
Each of those copies starts with a sync header that records which SHA of
`n3ary/standards` it was generated from:

```
<!-- synced from n3ary/standards@<sha> on <date> -->
<!-- do not edit locally; run scripts/vendor-standards.mjs to update -->
```

The drift check compares the SHA in that header against the current SHA on
`n3ary/standards@main`. Mismatch = drift.

This page covers **how drift is detected** (the check itself) and **how it
gets fixed** (the publisher's auto-vendor loop). The check is read-only; the
fix flows through the publisher.

## Where it lives

`n3ary/standards/.github/workflows/check-standards-drift.yml` is **not** the
canonical drift check — it's a template. Each consumer repo copies a small
drift-check workflow into its own `.github/workflows/`. The bodies are
identical except for the `gh`/auth idiom they use. Examples:

- `n3ary/app/.github/workflows/check-standards-drift.yml`
- `n3ary/gtfs/.github/workflows/check-standards-drift.yml`
- `n3ary/gtfs-adapters/.github/workflows/pr-validation.yml` (drift is folded into the validate job, with the same check logic)

The lifecycle is the same regardless of which file hosts the check: trigger
on `pull_request`, fail if any `docs/standards/*.md` is older than
`n3ary/standards@main`, succeed otherwise.

## The check algorithm

```bash
LATEST_SHA=$(gh api repos/n3ary/standards/commits/main --jq '.sha' | cut -c1-7)
DRIFT=0
for f in docs/standards/*.md; do
  [ -f "$f" ] || continue
  HEAD=$(head -1 "$f")
  echo "$HEAD" | grep -q 'synced from n3ary/standards@' || continue
  VENDORED_SHA=$(echo "$HEAD" | grep -oP 'n3ary/standards@\K[a-f0-9]+')
  if [ "$VENDORED_SHA" != "$LATEST_SHA" ]; then
    echo "Drift: $f vendored at $VENDORED_SHA, latest is $LATEST_SHA"
    DRIFT=1
  fi
done
[ "$DRIFT" = "1" ] && exit 1
```

Step by step:

1. Resolve `LATEST_SHA` — the short SHA at the tip of `n3ary/standards@main`.
   `gh` or `curl` with `Authorization: Bearer ${GH_TOKEN}` works; both are in
   use across the org.
2. For each `.md` in `docs/standards/`:
   - **Skip if missing the sync header.** Files that are consumer-local
     (e.g. `n3ary/app`'s `feed-agnostic.md` lives in `docs/standards/`
     because the renderer reads the whole folder) don't have the header and
     the check skips them. That's intentional — `feed-agnostic.md` is a
     consumer-owned rule and would false-positive if the check required a
     sync header on every file.
   - Parse the SHA from the first line, compare to `LATEST_SHA`.
3. Any mismatch → set `DRIFT=1`, print each drifted file with its old/new
   SHA, exit 1.

The check is **fail-loud only** on purpose. It does **not** edit files, push
commits, or open PRs from inside the consumer workflow. There are three
reasons:

1. **The GitHub Actions `GITHUB_TOKEN` on a PR can push new commits.** It
   does not, however, have permission to open a PR on a different repo, and
   rewriting files inside the consumer PR from a CI step is a footgun — it
   means the PR you're trying to merge has changed under you.
2. **The check should fail loud.** "Drift detected; here's what to do" makes
   the author wait for the canonical fix path. Silent auto-rebasing hides
   when the publisher is broken.
3. **The publisher has the only script that knows the canonical content.**
   Drift detection reads the headers; it doesn't have the source-of-truth
   files. Auto-fixing from the consumer would require either fetching the
   canonical SHA's contents (extra API rate-limit surface) or committing
   precomputed snapshots (drift). The publisher already does this work.

## The auto-fix path

Auto-fix lives on the publisher side. The loop is:

```
            push to n3ary/standards/standards/**
                          │
                          ▼
        sync-standards.yml runs the vendor script
                          │
                          ▼
   vendor-standards.mjs opens a chore/vendor-standards-<sha> PR in
   every consumer whose docs/standards/* actually changed
                          │
                          ▼
   each consumer's branch-protection requires a PR → review + merge
                          │
                          ▼
   consumer's docs/standards/<file>.md now carries the new SHA
                          │
                          ▼
   next drift-check on the next consumer PR sees matching SHA → green
```

So "auto-fix drift" means "the next sync-standards.yml run after the
publisher merged." There is no back-channel that fixes a consumer from
inside the drift check. If the publisher is broken, drift accumulates; if
it's healthy, the next push closes the loop.

There are two ways to keep that loop tight:

1. **The publisher is the only place the canonical lives.** Anyone wanting
   to change a rule opens a PR on `n3ary/standards`. PRs on consumer repos
   that try to edit `docs/standards/*.md` directly are *writing files the
   next sync will overwrite* — the `do not edit locally` header makes this
   explicit. The drift check is the safety net for when someone forgets.
2. **The sync workflow detects "nothing changed" and skips.** A push to
   `n3ary/standards` that only touches files a consumer doesn't import (or
   only touches `README.md`) will iterate the consumer list, compare each
   `docs/standards/*.md` against the new would-be content, and short-circuit
   with `[<consumer>] up-to-date, skipping`. This keeps the per-consumer PR
   noise flat — only one PR per consumer per real standards change.

## Manual override

A consumer author who wants to self-fix (e.g. the publisher is borked and
the standards change is needed *now*) can vendor locally:

```bash
cd <path-to-n3ary/standards>
node scripts/vendor-standards.mjs --local /tmp/vendor
cd <path-to-consumer-repo>
cp /tmp/vendor/* docs/standards/
git add docs/standards
git commit -m "chore(standards): manual sync from local checkout"
git push -u origin chore/manual-standards-sync
gh pr create --base main
```

The drift check passes as soon as the vendored SHA matches the publisher's
`main`. This does **not** short-circuit the next publisher-led sync — when
the publisher catches up, it'll see the consumer is already up to date at
that SHA and skip silently.

## Why drift is checked on **PR**, not on **schedule**

A scheduled job can also catch drift ("is this repo behind?"), but a
PR-scoped check is *actionable*: the PR author can either wait for the
auto-sync or stop and fix the underlying PR, both of which are clear next
steps at PR-open time. A scheduled job that fires "this repo is behind"
with no PR in flight generates noise.

If you want stronger guarantees, you can add a scheduled drift check in
addition — it's a free $0 check, since each invocation is one API call.
Today the org relies on the PR-scoped check plus the publisher's auto-fix
loop, and that's been sufficient.

## What drift is *not*

- **Not the same as "consumer PR will fail CI."** The drift check is a
  hard gate on `pull_request`. A consumer PR that has drift fails the
  check; merging it would write stale bytes to `main`. Branch protection on
  each consumer requires this check — exactly like any other required
  status check.
- **Not just "the file content differs from canonical."** A clean
  SHA match is the contract. Two files with byte-identical content but
  different sync headers (e.g. someone hand-edited the header) would *still*
  be drift. The check intentionally reads the header, not the body.
- **Not a substitute for a real diff review of the vendor PR.** The
  `chore/vendor-standards-<sha>` PR that the publisher opens is a normal PR.
  Worth a glance to confirm there's no surprise in the diff — same as any
  bot-generated PR.
