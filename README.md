# n3ary/standards

Governance standards for the [n3ary org](https://github.com/n3ary) repos. The contents of `standards/` are vendored into each consuming repo's `docs/standards/` directory by the sync-standards workflow.

## What this repo is

- **`standards/`** — the 13 markdown files that define org-wide rules (core principles, naming, documentation, etc.). Each file has a sync header (e.g. `-- synced from n3ary/standards@<sha> on <date> --`) so consumers can detect drift.
- **`scripts/vendor-standards.mjs`** — invoked by the sync-standards workflow; copies the latest standards into the consumer's `docs/standards/`.
- **`.github/workflows/sync-standards.yml`** — a reusable workflow (called from the drift-check in each consumer's PR validation).

## Consumers

- [`n3ary/app`](https://github.com/n3ary/app) — the consumer PWA
- [`n3ary/gtfs`](https://github.com/n3ary/gtfs) — the producer pipeline
- [`n3ary/cluj-napoca-gtfs-adapter`](https://github.com/n3ary/cluj-napoca-gtfs-adapter) — the Cluj sister adapter

## License

MIT.
