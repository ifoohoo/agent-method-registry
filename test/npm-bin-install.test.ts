/**
 * npm bin install tests — verify CLI works through npm-installed .bin and npx.
 *
 * These tests pack the current build into a tarball, install it in a fresh
 * temporary npm project, and invoke the CLI exclusively through:
 *   - node_modules/.bin/agent-method-registry  (npm symlink)
 *   - npx --no-install agent-method-registry
 *
 * Direct execution of dist/cli.js is NOT tested here — that is covered by
 * dist-blackbox.test.ts.  This file guards the real consumer path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const PACKAGE_DIR = resolve(import.meta.dirname, '..');
const VALID_CATALOG = resolve(PACKAGE_DIR, 'test/fixtures/catalogs/valid-plugin.yaml');
const PROVIDER_ROOT = resolve(PACKAGE_DIR, 'test-fixtures/provider-roots/artifact-chain-assistant');

type CliResult = { status: number | null; stdout: string; stderr: string };

function invoke(command: string, args: string[], cwd: string): CliResult {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function invokeNpx(args: string[]): CliResult {
  return invoke('npx', ['--no-install', 'agent-method-registry', ...args], consumer);
}

function envelope(result: CliResult): any {
  expect(result.stdout.trim()).not.toBe('');
  return JSON.parse(result.stdout.trim());
}

let root: string;
let consumer: string;
let bin: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'amr-npm-bin-'));
  consumer = join(root, 'consumer');
  mkdirSync(consumer, { recursive: true });
  invoke('npm', ['run', 'build'], PACKAGE_DIR);
  const packed = invoke('npm', ['pack', '--json', '--pack-destination', root], PACKAGE_DIR);
  expect(packed.status).toBe(0);
  const filename = JSON.parse(packed.stdout)[0].filename;
  const installed = invoke('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
    join(root, filename),
  ], consumer);
  expect(installed.status).toBe(0);
  bin = join(consumer, 'node_modules/.bin/agent-method-registry');
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

// ═══════════════════════════════════════════════════════════════════════════
// .bin — usage / semantic failures
// ═══════════════════════════════════════════════════════════════════════════

describe('installed npm bin — usage branch', () => {
  it('no command: exit 2, CLI_USAGE_ERROR', () => {
    const result = invoke(bin, [], consumer);
    expect(result.status).toBe(2);
    expect(envelope(result).diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .bin — validate success
// ═══════════════════════════════════════════════════════════════════════════

describe('installed npm bin — validate', () => {
  it('valid catalog: exit 0, ok envelope', () => {
    const result = invoke(bin, ['validate', '--catalog', VALID_CATALOG], consumer);
    expect(result.status).toBe(0);
    expect(envelope(result)).toEqual({ ok: true, data: null, diagnostics: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .bin — index success + real file output
// ═══════════════════════════════════════════════════════════════════════════

describe('installed npm bin — index', () => {
  it('index with --out: exit 0, file written and parseable', () => {
    const indexPath = join(consumer, 'effective-index.json');
    const result = invoke(bin, [
      'index', '--catalog', VALID_CATALOG, '--out', indexPath,
    ], consumer);
    expect(result.status).toBe(0);
    expect(envelope(result).ok).toBe(true);
    const indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(indexData.entries.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .bin — query success
// ═══════════════════════════════════════════════════════════════════════════

describe('installed npm bin — query', () => {
  it('query returns non-empty compact entries', () => {
    const indexPath = join(consumer, 'effective-index.json');
    const result = invoke(bin, ['query', '--index', indexPath], consumer);
    expect(result.status).toBe(0);
    expect(envelope(result).data.entries.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .bin — resolve success & semantic failure
// ═══════════════════════════════════════════════════════════════════════════

describe('installed npm bin — resolve', () => {
  it('resolve existing entry: exit 0, verified', () => {
    const indexPath = join(consumer, 'effective-index.json');
    const result = invoke(bin, [
      'resolve', '--index', indexPath,
      '--ref', 'artifact.prd-feature.author',
      '--host', 'claude-code',
      '--plugin-root', PROVIDER_ROOT,
    ], consumer);
    expect(result.status).toBe(0);
    expect(envelope(result).data.verification.status).toBe('verified');
  });

  it('resolve missing entry: exit 1, ENTRY_NOT_FOUND', () => {
    const indexPath = join(consumer, 'effective-index.json');
    const result = invoke(bin, [
      'resolve', '--index', indexPath,
      '--ref', 'missing.entry', '--host', 'claude-code',
    ], consumer);
    expect(result.status).toBe(1);
    expect(envelope(result).diagnostics[0].code).toBe('ENTRY_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// npx --no-install — equivalence gate
// ═══════════════════════════════════════════════════════════════════════════

describe('npx --no-install — equivalence', () => {
  it('npx validate: exit 0, ok envelope', () => {
    const result = invokeNpx(['validate', '--catalog', VALID_CATALOG]);
    expect(result.status).toBe(0);
    expect(envelope(result).ok).toBe(true);
  });

  it('npx no command: exit 2, CLI_USAGE_ERROR', () => {
    const result = invokeNpx([]);
    expect(result.status).toBe(2);
    expect(envelope(result).diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});
