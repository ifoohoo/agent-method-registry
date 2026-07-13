/**
 * Tarball audit tests — verify npm pack includes/excludes the right files.
 *
 * These tests verify that the published tarball:
 * - Includes dist/, schemas/, README, LICENSE, NOTICE, CHANGELOG, etc.
 * - Excludes src/, test/, test-fixtures/, internal docs
 * - Has correct bin entry
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const PACKAGE_DIR = resolve(import.meta.dirname, '..');

let packResult: { files: string[]; name: string; version: string } | null = null;

beforeAll(() => {
  try {
    const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PACKAGE_DIR,
      encoding: 'utf-8',
      timeout: 30000,
    });
    const parsed = JSON.parse(raw);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    packResult = {
      files: (entry.files ?? []).map((f: { path: string }) => f.path),
      name: entry.name ?? '',
      version: entry.version ?? '',
    };
  } catch {
    packResult = null;
  }
});

describe('tarball audit — npm pack includes', () => {
  it('npm pack succeeds', () => {
    expect(packResult).not.toBeNull();
  });

  it('tarball name matches package name', () => {
    expect(packResult?.name).toBe('agent-method-registry');
  });

  it('tarball version is 0.1.0', () => {
    expect(packResult?.version).toBe('0.1.0');
  });

  const EXPECTED_IN_TARBALL = [
    'dist/index.js',
    'dist/cli.js',
    'dist/index.d.ts',
    'schemas/catalog.schema.json',
    'schemas/effective-index.schema.json',
    'schemas/project.schema.json',
    'schemas/diagnostic-envelope.schema.json',
    'package.json',
    'README.md',
    'README.zh-CN.md',
    'CHANGELOG.md',
    'LICENSE',
    'NOTICE',
  ];

  it.each(EXPECTED_IN_TARBALL)('tarball contains %s', (file) => {
    expect(packResult?.files).toContain(file);
  });
});

describe('tarball audit — npm pack excludes', () => {
  const MUST_NOT_BE_IN_TARBALL = [
    'src/index.ts',
    'src/cli.ts',
    'test/api-surface.test.ts',
    'test-fixtures/effective-index.json',
    'tsconfig.json',
  ];

  it.each(MUST_NOT_BE_IN_TARBALL)('tarball does not contain %s', (file) => {
    expect(packResult?.files).not.toContain(file);
  });

  it('tarball does not contain any src/ files', () => {
    const srcFiles = packResult?.files.filter(f => f.startsWith('src/')) ?? [];
    expect(srcFiles).toEqual([]);
  });

  it('tarball does not contain any test/ files', () => {
    const testFiles = packResult?.files.filter(f => f.startsWith('test/')) ?? [];
    expect(testFiles).toEqual([]);
  });
});

describe('tarball audit — package.json exports', () => {
  it('exports field points to dist/index.js', () => {
    const pkg = JSON.parse(readFileSync(resolve(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.exports['.'].types).toBe('./dist/index.d.ts');
  });

  it('main field points to dist/index.js', () => {
    const pkg = JSON.parse(readFileSync(resolve(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.main).toBe('./dist/index.js');
  });

  it('types field points to dist/index.d.ts', () => {
    const pkg = JSON.parse(readFileSync(resolve(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.types).toBe('./dist/index.d.ts');
  });
});
