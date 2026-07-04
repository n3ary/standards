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
    repo: 'n3ary/cluj-napoca-gtfs-adapter',
    vendorDir: 'docs/standards',
    skip: new Set(),
  },
];

function gitHeadShort() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
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
  const sha = gitHeadShort();
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
  const sha = gitHeadShort();
  const date = todayIsoDate();
  const branchName = `chore/vendor-standards-${sha}`;

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

      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[${consumer.repo}] failed: ${err.message}`);
    }
  }
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