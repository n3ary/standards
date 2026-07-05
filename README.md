# n3ary/standards

Governance standards for the [n3ary org](https://github.com/n3ary) repos. The contents of `standards/` are vendored into each consuming repo's `docs/standards/` directory by the sync-standards workflow.

## What this repo is

- **`standards/`** — the 13 markdown files that define org-wide rules (core principles, naming, documentation, etc.). Each file has a sync header (e.g. `-- synced from n3ary/standards@<sha> on <date> --`) so consumers can detect drift.
- **`scripts/vendor-standards.mjs`** — invoked by the sync-standards workflow; copies the latest standards into the consumer's `docs/standards/`.
- **`.github/workflows/sync-standards.yml`** — a reusable workflow (called from the drift-check in each consumer's PR validation).
- **`docs/`** — architecture documentation for the sync machinery. See [docs/README.md](./docs/README.md) for the index. Start with [docs/architecture.md](./docs/architecture.md) for the system overview, then [docs/sync-workflow.md](./docs/sync-workflow.md) and [docs/drift-detection.md](./docs/drift-detection.md) for the per-workflow walkthroughs.

## Consumers

- [`n3ary/app`](https://github.com/n3ary/app) — the consumer PWA
- [`n3ary/gtfs`](https://github.com/n3ary/gtfs) — the producer pipeline
- `n3ary/gtfs-adapters/tree/main/adapters/cluj-napoca` — the Cluj adapter (inside the `gtfs-adapters` monorepo; the legacy standalone repo is archived as `n3ary/archived-adapter`)

## License

MIT.
