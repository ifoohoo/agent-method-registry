/**
 * Dist cleanliness tests — verify that the build deterministically cleans dist/
 * before writing new outputs, and that stale / duplicate hashed artifacts are
 * never left behind.
 *
 * Injects known stale files (old hashed chunk, old hashed codes .d.ts, and an
 * unknown file), runs the build, and asserts all stale files are removed while
 * the expected dist artifacts survive.
 *
 * This file is self-contained: it backs up dist, runs the experiment, and
 * leaves the clean build output in place (not the stale backup).
 *
 * IMPORTANT: Tests run sequentially (fileParallelism: false in vitest.config.ts)
 * to prevent races on the shared dist/ directory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  readdirSync,
  cpSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';

const PACKAGE_DIR = resolve(import.meta.dirname, '..');
const DIST_DIR = resolve(PACKAGE_DIR, 'dist');
const BACKUP_DIR = resolve(PACKAGE_DIR, '.dist-backup');

/** List sorted files in dist/, excluding hidden files. */
function listDist(): string[] {
  if (!existsSync(DIST_DIR)) return [];
  return readdirSync(DIST_DIR)
    .filter((f) => !f.startsWith('.'))
    .sort();
}

/** Match tsup-generated chunk filenames: chunk-<HASH>.js */
const CHUNK_RE = /^chunk-[A-Za-z0-9]+\.js$/;
/** Match tsup-generated codes type filenames: codes-<HASH>.d.ts */
const CODES_RE = /^codes-[A-Za-z0-9]+\.d\.ts$/;
/** Known non-hashed dist entry points (after build). */
const EXPECTED_FIXED = ['cli.d.ts', 'cli.js', 'index.d.ts', 'index.js'];

beforeAll(() => {
  // ── backup current dist ──
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  mkdirSync(BACKUP_DIR, { recursive: true });
  cpSync(DIST_DIR, BACKUP_DIR, { recursive: true });

  // ── inject stale files ──
  writeFileSync(resolve(DIST_DIR, 'chunk-JJHM2J4Q.js'), '// stale chunk');
  writeFileSync(resolve(DIST_DIR, 'codes-DVFhPupO.d.ts'), '// stale codes types');
  writeFileSync(resolve(DIST_DIR, 'unknown-legacy.js'), '// unknown stale artifact');

  // ── run clean build ──
  execFileSync('npm', ['run', 'build'], {
    cwd: PACKAGE_DIR,
    encoding: 'utf-8',
    timeout: 60_000,
  });
});

afterAll(() => {
  // Do NOT restore the stale backup — leave the clean build output in place.
  // This ensures tarball-audit.test.ts (which runs after this file) sees the
  // clean dist produced by the build, not the original stale state.
  rmSync(BACKUP_DIR, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════
// STALE FILE REMOVAL
// ═══════════════════════════════════════════════════════════════

describe('dist cleanliness — stale file removal', () => {
  it('removes stale old-hashed chunk file (chunk-JJHM2J4Q.js)', () => {
    expect(existsSync(resolve(DIST_DIR, 'chunk-JJHM2J4Q.js'))).toBe(false);
  });

  it('removes stale old-hashed codes d.ts file (codes-DVFhPupO.d.ts)', () => {
    expect(existsSync(resolve(DIST_DIR, 'codes-DVFhPupO.d.ts'))).toBe(false);
  });

  it('removes unknown injected file (unknown-legacy.js)', () => {
    expect(existsSync(resolve(DIST_DIR, 'unknown-legacy.js'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// DUPLICATE HASHED ARTIFACT REJECTION
// ═══════════════════════════════════════════════════════════════

describe('dist cleanliness — no duplicate hashed artifacts', () => {
  it('exactly one chunk-<hash>.js exists', () => {
    const chunks = listDist().filter((f) => CHUNK_RE.test(f));
    expect(chunks).toHaveLength(1);
  });

  it('exactly one codes-<hash>.d.ts exists', () => {
    const codes = listDist().filter((f) => CODES_RE.test(f));
    expect(codes).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// EXPECTED DIST FILE SET
// ═══════════════════════════════════════════════════════════════

describe('dist cleanliness — expected file set', () => {
  it('every dist file is either an expected fixed entry or a known hashed pattern', () => {
    const files = listDist();
    for (const file of files) {
      const isFixed = EXPECTED_FIXED.includes(file);
      const isChunk = CHUNK_RE.test(file);
      const isCodes = CODES_RE.test(file);
      expect(
        isFixed || isChunk || isCodes,
        `Unexpected dist file: ${file}`,
      ).toBe(true);
    }
  });

  it('all expected fixed entry points are present', () => {
    const files = listDist();
    for (const expected of EXPECTED_FIXED) {
      expect(files, `Missing dist file: ${expected}`).toContain(expected);
    }
  });

  it('dist contains exactly 6 files (4 fixed + 1 chunk + 1 codes)', () => {
    expect(listDist()).toHaveLength(6);
  });

  it('cli.js has shebang preserved', () => {
    const cli = resolve(DIST_DIR, 'cli.js');
    const content = require('node:fs').readFileSync(cli, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// NPM PACK — NO STALE DIST IN TARBALL
// ═══════════════════════════════════════════════════════════════

describe('dist cleanliness — npm pack rejects stale dist artifacts', () => {
  let packDistFiles: string[];

  beforeAll(() => {
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    const parsed = JSON.parse(raw);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    packDistFiles = (entry.files as { path: string }[])
      .map((f) => f.path)
      .filter((p) => p.startsWith('dist/'))
      .sort();
  });

  it('tarball dist contains no duplicate hashed chunk files', () => {
    const chunks = packDistFiles.filter((f) => /^dist\/chunk-[A-Za-z0-9]+\.js$/.test(f));
    expect(chunks).toHaveLength(1);
  });

  it('tarball dist contains no duplicate hashed codes d.ts', () => {
    const codes = packDistFiles.filter((f) => /^dist\/codes-[A-Za-z0-9]+\.d\.ts$/.test(f));
    expect(codes).toHaveLength(1);
  });

  it('tarball dist contains no unknown files', () => {
    for (const file of packDistFiles) {
      const base = file.replace('dist/', '');
      const isFixed = EXPECTED_FIXED.includes(base);
      const isChunk = CHUNK_RE.test(base);
      const isCodes = CODES_RE.test(base);
      expect(
        isFixed || isChunk || isCodes,
        `Unknown dist file in tarball: ${file}`,
      ).toBe(true);
    }
  });

  it('tarball dist has exactly 6 files', () => {
    expect(packDistFiles).toHaveLength(6);
  });
});
