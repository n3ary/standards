# Consumer integration

Adding a new repo to the standards pool means: register it in the
publisher's `CONSUMERS` list, drop a drift check + ignore paths into the
consumer, and seed its `docs/standards/`. Nothing else changes — the rest of
the vendoring machinery is publisher-owned.

## 1. Register the repo in the publisher

Edit `scripts/vendor-standards.mjs` in `n3ary/standards` and add an entry to
the `CONSUMERS` array:

```js
const CONSUMERS = [
  // …existing entries…
  {
    repo: 'n3ary/<new-repo>',
    vendorDir: 'docs/standards',
    skip: new Set(),  // any standards/<name>.md files this consumer shouldn't import
  },
];
```

If the consumer needs a different vendor directory (e.g. for a non-docs
layout), set `vendorDir` accordingly. The `skip` set is for consumer-local
files that already happen to live in `docs/standards/` (today only
`feed-agnostic.md` on `n3ary/app` is in this category — leave the set empty
unless you have the same pattern).

## 2. Add a drift check to the consumer

Drop `.github/workflows/check-standards-drift.yml` into the new repo. The
canonical body is identical to `n3ary/gtfs`'s version:

```yaml
name: Check Standards Drift

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR branch
        uses: actions/checkout@v7
        with:
          ref: ${{ github.head_ref || github.ref }}
          fetch-depth: 1

      - name: Check vendored standards against n3ary/standards@main
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -e
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
          if [ "$DRIFT" = "1" ]; then
            echo "Drift detected. Wait for the auto-sync PR from n3ary/standards, or run the vendor script locally."
            exit 1
          fi
          echo "All vendored standards up to date with n3ary/standards@main ($LATEST_SHA)."
```

If the consumer already has a `pr-validation.yml`, the drift check can be
folded into that workflow as a separate job instead of a standalone file —
`n3ary/gtfs-adapters/.github/workflows/pr-validation.yml` is the precedent.

Wire the check into branch protection as a required status check on
`main` (same as `validate` on the rest of the org). The check name on the
run page is `drift-check` — that's what GH expects in branch-protection
settings.

## 3. Seed `docs/standards/` on first import

There are two reasonable first-sync shapes:

- **Let the publisher do it.** Add the entry in step 1, push to
  `n3ary/standards/main`. The workflow fires, walks the new repo's `main`
  via clone, and attempts to write `docs/standards/<file>.md`. Because the
  folder doesn't exist yet, every file *is* a change — the workflow
  commits them all in one PR. No seeding needed.
- **Seed locally first.** From a checkout of `n3ary/standards`:

  ```bash
  node scripts/vendor-standards.mjs --local /tmp/vendor
  ```

  Then `cp /tmp/vendor/* docs/standards/` in the consumer, commit, and open
  a PR. When the publisher's next run fires, it'll diff against this
  already-current copy and skip silently.

Either is fine. The first option produces one extra vendor PR; the second
option produces a manually-authored first import that the publisher will
then leave alone.

## 4. Add the standard workflow ignore paths

If the consumer has its own `.github/workflows/*.yml` that builds or
deploys, make sure its `paths-ignore` (or `bump-skip-paths` if it uses the
`n3ary/actions/.github/actions/version-bump@v1` action) covers
`docs/standards/`:

```yaml
# in a push-triggered deploy/daily workflow:
paths-ignore:
  - 'docs/**'
  - '.github/**'
  - '.gitignore'
  - 'LICENSE'
```

Without this, every standards-vendor PR triggers a full daily build or
redeploy. The vendored files don't change runtime code, so they shouldn't
kick expensive pipelines.

## 5. Add the consumer to the README

`README.md` in `n3ary/standards` lists every consumer under "Consumers".
Add the new repo so it's discoverable from the publisher side.

## 6. Make sure `STANDARDS_SYNC_TOKEN` covers the new repo

The PAT under `STANDARDS_SYNC_TOKEN` in `n3ary/standards` needs write access
to every consumer. If it's a classic PAT with `repo` scope that's already
true for all `n3ary/*` repos; if it's a fine-grained PAT, add the new repo
to its *Resources* list with *Contents: write* + *Pull requests: write*.

Without this update, the next sync run logs
`[<repo>] failed: gh: Not authorized` for the new consumer and the others
still complete — but the new one will never receive a vendor PR.

## Sanity check after onboarding

After the first `sync-standards.yml` run for the new consumer:

1. A `chore/vendor-standards-<sha>` PR exists in the new repo with all 13
   standards vendored under `docs/standards/`.
2. Merging it lands `docs/standards/*.md` with valid sync headers on
   `main`.
3. Opening a no-op PR on the consumer (e.g. a typo fix in some unrelated
   file) fires `check-standards-drift.yml`, which should report
   `All vendored standards up to date with n3ary/standards@main (<sha>).`

If any of those are wrong, the most common cause is a missing/expired
token on the publisher — re-check `STANDARDS_SYNC_TOKEN`.
