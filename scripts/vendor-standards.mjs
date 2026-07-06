#!/usr/bin/env node
/**
 * vendor-standards.mjs
 *
 * Vendors `standards/*.md` from this repo into each consumer repo's
 * `docs/standards/`, prefixed with a sync header that records the
 * source SHA + date. Opens a vendor PR in each consumer repo.
 *
 * Default mode: opens PRs in the configured consumer repos via `gh`.
 *
 * `--local <dir>` mode: writes the vendored copies into a local
 * directory for inspection (no git operations).
 *
 * Vendor file format:
 *
 *     <!-- synced from n3ary/standards@<sha> on <date> -->
 *     <!-- do not edit locally; run scripts/vendor-standards.mjs to update -->
 *
 *     (standard content)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STANDARDS_DIR = join(__dirname, '..', 'standards');

// Consumer repos. Add new repos here.
const CONSUMERS = [
  {
    repo: 'n3ary/app',
    vendorDir: 'docs/standards',
    skip: new Set(['feed-agnostic.md']), // local-only — stays in the consumer repo
  },
  {
    repo: 'n3ary/gtfs',
    vendorDir: 'docs/standards',
    skip: new Set(),
  },
  {
    // gtfs-adapters is a monorepo (adapters/<feed>/) but standards vendored
    // here are repo-wide. Any per-adapter standard overrides live and have
    // their lifecycle inside the adapter - they are not vendored centrally.
    repo: 'n3ary/gtfs-adapters',
    vendorDir: 'docs/standards',
    skip: new Set(),
  },
];

function repoSlug() {
  // Derive the owner/repo for the current git checkout — used to call
  // the GitHub API for SHA resolution. Works in any clone (local or CI).
  const url = execFileSync(
    'git',
    ['-C', __dirname, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8' },
  ).trim();
  const m = url.match(/[:/]([^/:]+\/[^/.]+?)(?:\.git)?$/);
  if (!m) throw new Error(`Could not parse owner/repo from origin URL: ${url}`);
  return m[1];
}

function lastStandardsSha() {
  // The "where did this content come from" label baked into each
  // vendored file's sync header. We deliberately resolve it via the
  // GitHub API as the SHA of the most recent commit on main that
  // touched any file under standards/, NOT as HEAD of main.
  //
  // Why: drift-check (n3ary/actions/.github/workflows/check-standards-drift.yml)
  // compares this label against the same API call. Tracking HEAD would
  // create false-positive drift on every non-standards commit on
  // n3ary/standards/main (e.g. a docs/ or .github/ change) — none of
  // which actually moved the standards content, but the SHA would.
  //
  // Falls back to HEAD if the API isn't usable (e.g. running outside
  // the standards repo, or in a test) so the helper never throws
  // during a routine vendor run.
  let slug;
  try {
    slug = repoSlug();
  } catch {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
  }
  try {
    const sha = execFileSync(
      'gh',
      [
        'api',
        `repos/${slug}/commits?sha=main&path=standards&per_page=1`,
        '--jq', '.[0].sha',
      ],
      { cwd: __dirname, encoding: 'utf8' },
    ).trim();
    if (!sha) throw new Error(`API returned empty SHA for ${slug}@main touching path=standards`);
    return sha.slice(0, 7);
  } catch (err) {
    console.warn(`[warn] lastStandardsSha() fell back to HEAD: ${err.message}`);
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
  }
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function header(sha, date) {
  return `<!-- synced from n3ary/standards@${sha} on ${date} -->\n` +
         `<!-- do not edit locally; run scripts/vendor-standards.mjs to update -->\n\n`;
}

function listStandards() {
  return readdirSync(STANDARDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

function vendorContent(sha, date, original) {
  return header(sha, date) + original;
}

function runGh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function vendorLocalMode(targetDir) {
  const sha = lastStandardsSha();
  const date = todayIsoDate();
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  for (const file of listStandards()) {
    if (file === 'README.md' || file === 'SHARED-STANDARDS.md') continue; // manifest + index stay canonical-only
    const original = readFileSync(join(STANDARDS_DIR, file), 'utf8');
    writeFileSync(join(targetDir, file), vendorContent(sha, date, original));
  }
  console.log(`Wrote vendored standards to ${targetDir}`);
}

function prMode() {
  const sha = lastStandardsSha();
  const date = todayIsoDate();
  const branchName = `chore/vendor-standards-${sha}`;

  // Per-run summary written next to the script so the workflow's
  // Summary step can surface pass/fail counts. The previous version
  // of this script caught per-consumer errors and exited 0, so a
  // "success" workflow run could silently vendor zero repos. Reading
  // this file in the Summary step is the single source of truth for
  // "did the cross-repo fan-out actually land?".
  const summaryPath = process.env.VENDOR_SUMMARY_PATH || '/tmp/vendor-standards-summary.json';
  const summary = { sha, results: [] };

  for (const consumer of CONSUMERS) {
    try {
      const filesToVendor = listStandards()
        .filter((f) => f !== 'README.md' && f !== 'SHARED-STANDARDS.md')
        .filter((f) => !consumer.skip.has(f));

      const hasChanges = filesToVendor.length > 0;

      // Clone consumer repo to a temp dir
      const tmpDir = `/tmp/vendor-${consumer.repo.replace('/', '-')}-${sha}`;
      rmSync(tmpDir, { recursive: true, force: true });
      execFileSync('gh', ['repo', 'clone', consumer.repo, tmpDir, '--', '--depth=1'], { stdio: 'pipe' });
      execFileSync('git', ['-C', tmpDir, 'checkout', '-b', branchName]);

      // Set per-clone git identity. GitHub Actions runners ship with no
      // global user.name / user.email, so `git commit` fails with
      // "Author identity unknown" unless we set them. The workflow file
      // also sets these globally as a belt-and-braces; doing it per-clone
      // here means the script is correct even when run outside Actions
      // (e.g. for a local `node scripts/vendor-standards.mjs --local ...`
      // vendor).
      execFileSync('git', ['-C', tmpDir, 'config', 'user.email', 'n3ary-standards-bot@users.noreply.github.com']);
      execFileSync('git', ['-C', tmpDir, 'config', 'user.name',  'n3ary-standards-bot']);

      // Set per-clone credential helper so `git push` (and any other
      // git remote operation) authenticates with the same token `gh` is
      // using. Without this, `git push` falls back to prompting for
      // a username/password, which fails on Actions with
      // "could not read Username for 'https://github.com'".
      // The helper `!gh auth git-credential` calls back into gh to
      // produce the credential, using whatever GH_TOKEN is in the
      // environment. Per-clone (not global) so we don't pollute the
      // user's git config when this script is run locally.
      execFileSync('git', ['-C', tmpDir, 'config', 'credential.helper', '!gh auth git-credential']);

      // Write vendored files
      mkdirSync(join(tmpDir, consumer.vendorDir), { recursive: true });
      let anyChanged = false;
      for (const file of filesToVendor) {
        const destPath = join(tmpDir, consumer.vendorDir, file);
        const newContent = vendorContent(sha, date, readFileSync(join(STANDARDS_DIR, file), 'utf8'));
        let changed = true;
        if (existsSync(destPath)) {
          const existing = readFileSync(destPath, 'utf8');
          if (existing === newContent) changed = false;
        }
        if (changed) {
          writeFileSync(destPath, newContent);
          anyChanged = true;
        }
      }

      if (!anyChanged) {
        console.log(`[${consumer.repo}] up-to-date, skipping`);
        summary.results.push({ consumer: consumer.repo, status: 'up-to-date' });
        rmSync(tmpDir, { recursive: true, force: true });
        continue;
      }

      // Commit + push + open PR
      execFileSync('git', ['-C', tmpDir, 'add', '.'], { stdio: 'pipe' });
      execFileSync('git', ['-C', tmpDir, 'commit', '-m', `chore(standards): vendor from n3ary/standards@${sha}\n\n${hasChanges}`], { stdio: 'pipe' });
      execFileSync('git', ['-C', tmpDir, 'push', '-u', 'origin', branchName], { stdio: 'pipe' });

      const body = [
        `Vendor shared standards from \`n3ary/standards@${sha}\`.`,
        '',
        'Files vendored:',
        ...filesToVendor.map((f) => `- \`${f}\``),
        '',
        'Do not edit the vendored copies locally — they\'re overwritten by the next sync.',
      ].join('\n');

      const prUrl = runGh([
        'pr', 'create',
        '--repo', consumer.repo,
        '--base', 'main',
        '--head', branchName,
        '--title', `chore(standards): vendor from n3ary/standards@${sha}`,
        '--body', body,
      ]).trim();
      console.log(`[${consumer.repo}] opened PR: ${prUrl}`);

      summary.results.push({ consumer: consumer.repo, status: 'opened', prUrl });
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[${consumer.repo}] failed: ${err.message}`);
      summary.results.push({ consumer: consumer.repo, status: 'failed', error: err.message });
    }
  }

  // Write summary for the workflow's Summary step to read.
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  // Exit non-zero if ANY consumer failed. The workflow's
  // `summary.results` check below will see this and surface it in
  // the run summary; the job also fails the check, so the next push
  // can't hide a regression in a green run.
  const anyFailed = summary.results.some((r) => r.status === 'failed');
  if (anyFailed) process.exit(1);
}

const args = process.argv.slice(2);
const localIdx = args.indexOf('--local');
if (localIdx !== -1) {
  const targetDir = args[localIdx + 1];
  if (!targetDir) {
    console.error('--local requires a target directory argument');
    process.exit(1);
  }
  vendorLocalMode(targetDir);
} else {
  prMode();
}