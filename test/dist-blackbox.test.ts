/**
 * Dist black-box tests — spawn the built dist/cli.js as a real subprocess.
 *
 * These tests verify the ACTUAL built CLI behavior, not source imports.
 * A fresh build is run in beforeAll to ensure the dist is current.
 *
 * Build runner: uses `npm run build` (NOT pnpm) so the test works in any
 * environment where npm is available, even if pnpm is not installed.
 *
 * Covers: query success/no-match/usage/data failure,
 * resolve verified/provider failure, malformed index,
 * single JSON stdout, and accurate exit codes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

const PACKAGE_DIR = resolve(import.meta.dirname, '..');
const DIST_CLI = resolve(PACKAGE_DIR, 'dist', 'bin.js');
const FIXTURE_INDEX = resolve(PACKAGE_DIR, 'test-fixtures', 'effective-index.json');
const PROVIDER_ROOTS = resolve(PACKAGE_DIR, 'test-fixtures', 'provider-roots');

function runCli(args: string[]): { stdout: string; exitCode: number; envelope: any } {
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync('node', [DIST_CLI, ...args], {
      encoding: 'utf-8',
      timeout: 15000,
      // Do not throw on non-zero exit — we want to capture the output
      // execFileSync DOES throw on non-zero, so we catch below
    });
  } catch (err: any) {
    stdout = err.stdout ?? '';
    exitCode = err.status ?? 1;
  }
  let envelope: any;
  try { envelope = JSON.parse(stdout.trimEnd()); } catch { envelope = null; }
  return { stdout, exitCode, envelope };
}

function assertSingleJson(stdout: string): void {
  const trimmed = stdout.trimEnd();
  const parsed = JSON.parse(trimmed);
  expect(trimmed).toBe(JSON.stringify(parsed));
}

let tmpDir: string;

beforeAll(() => {
  // Fresh build using `npm run build` — robust in any environment with npm.
  // Does NOT depend on pnpm being installed or on PATH.
  execFileSync('npm', ['run', 'build'], {
    cwd: PACKAGE_DIR,
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, PATH: process.env.PATH },
  });

  tmpDir = join(tmpdir(), `dist-blackbox-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  return () => {
    rmSync(tmpDir, { recursive: true, force: true });
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// BUILD RUNNER — self-verification that build mechanism is pnpm-independent
// ═══════════════════════════════════════════════════════════════════════════

describe('dist blackbox — build runner robustness', () => {
  it('build runner uses npm, not pnpm', () => {
    // Read the beforeAll section of this file to verify the build runner
    // uses `npm run build` and not `pnpm build`.
    // This guards against regressions where someone re-hardcodes pnpm.
    const thisFile = readFileSync(new URL(import.meta.url), 'utf-8');
    const beforeAllBlock = thisFile.slice(
      thisFile.indexOf('beforeAll(() => {'),
      thisFile.indexOf('});', thisFile.indexOf('beforeAll(() => {')) + 3,
    );
    // beforeAll must call npm, not pnpm
    expect(beforeAllBlock).toContain("execFileSync('npm'");
    expect(beforeAllBlock).not.toContain("execFileSync('pnpm'");
  });

  it('fresh dist exists and is current after build', () => {
    // The beforeAll already ran `npm run build`. Verify dist/cli.js exists.
    expect(() => readFileSync(DIST_CLI, 'utf-8')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — success cases
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI query — success', () => {
  it('compact query returns ok:true with entries, exit 0', () => {
    const { exitCode, envelope, stdout } = runCli([
      'query', '--index', FIXTURE_INDEX,
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.entries)).toBe(true);
    expect(envelope.data.entries.length).toBeGreaterThan(0);
    for (const entry of envelope.data.entries) {
      expect(Object.keys(entry).sort()).toEqual(['kind', 'ref', 'summary']);
    }
    assertSingleJson(stdout);
  });

  it('no-match returns ok:true with empty entries, exit 0', () => {
    const { exitCode, envelope } = runCli([
      'query', '--index', FIXTURE_INDEX, '--domain', 'nonexistent-domain',
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toEqual([]);
    expect(envelope.diagnostics[0].code).toBe('NO_QUERY_MATCH');
    expect(envelope.diagnostics[0].severity).toBe('info');
  });

  it('full format returns complete entries', () => {
    const { exitCode, envelope } = runCli([
      'query', '--index', FIXTURE_INDEX, '--format', 'full',
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    for (const entry of envelope.data.entries) {
      expect(entry).toHaveProperty('ref');
      expect(entry).toHaveProperty('provider');
      expect(entry).toHaveProperty('kind');
      expect(entry).toHaveProperty('summary');
      expect(entry).toHaveProperty('match');
      expect(entry).toHaveProperty('provenance');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — data failures (exit 1)
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI query — data failures', () => {
  it('exit 1 for missing index file', () => {
    const { exitCode, envelope, stdout } = runCli([
      'query', '--index', '/nonexistent/path.json',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('INPUT_READ_FAILED');
    assertSingleJson(stdout);
  });

  it('exit 1 for malformed JSON index', () => {
    const badPath = join(tmpDir, 'bad-query.json');
    writeFileSync(badPath, '{invalid');
    const { exitCode, envelope } = runCli([
      'query', '--index', badPath,
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('INPUT_READ_FAILED');
  });

  it('exit 1 for structurally invalid effective index', () => {
    const badPath = join(tmpDir, 'stale-query.json');
    writeFileSync(badPath, JSON.stringify({ bad: 'index' }));
    const { exitCode, envelope } = runCli([
      'query', '--index', badPath,
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUERY — usage errors (exit 2)
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI query — usage errors', () => {
  it('exit 2 for missing --index', () => {
    const { exitCode, envelope, stdout } = runCli(['query']);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
    assertSingleJson(stdout);
  });

  it('exit 2 for bare --index (no value)', () => {
    const { exitCode, envelope } = runCli(['query', '--index']);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for extra positional arg', () => {
    const { exitCode, envelope } = runCli([
      'query', '--index', FIXTURE_INDEX, 'stray',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for unknown flag', () => {
    const { exitCode, envelope } = runCli([
      'query', '--index', FIXTURE_INDEX, '--bogus', 'val',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE — success cases
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI resolve — success', () => {
  it('plugin resolve returns verified status, exit 0', () => {
    const pluginRoot = resolve(PROVIDER_ROOTS, 'artifact-chain-assistant');
    const { exitCode, envelope, stdout } = runCli([
      'resolve',
      '--index', FIXTURE_INDEX,
      '--ref', 'artifact.prd-feature.author',
      '--host', 'claude-code',
      '--plugin-root', pluginRoot,
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entry.ref).toBe('artifact.prd-feature.author');
    expect(envelope.data.entry.kind).toBe('workflow');
    expect(envelope.data.entry.provider.scope).toBe('plugin');
    expect(envelope.data.entry.provider.plugin).toBe('artifact-chain-assistant');
    expect(envelope.data.verification.status).toBe('verified');
    expect(envelope.data.verification.host).toBe('claude-code');
    expect(typeof envelope.data.index_content_hashes.catalogs['artifact-chain-assistant']).toBe('string');
    expect(envelope.data.index_content_hashes.catalogs['artifact-chain-assistant']).toMatch(/^[0-9a-f]{64}$/);
    assertSingleJson(stdout);
  });

  it('resolve entry not found returns exit 1', () => {
    const { exitCode, envelope } = runCli([
      'resolve',
      '--index', FIXTURE_INDEX,
      '--ref', 'nonexistent.ref',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('ENTRY_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE — provider failures (exit 1)
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI resolve — provider failures', () => {
  it('exit 1 for provider not found', () => {
    const emptyRoot = join(tmpDir, 'empty-provider-root');
    mkdirSync(emptyRoot, { recursive: true });
    const { exitCode, envelope } = runCli([
      'resolve',
      '--index', FIXTURE_INDEX,
      '--ref', 'artifact.prd-feature.author',
      '--host', 'claude-code',
      '--plugin-root', emptyRoot,
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('PROVIDER_NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE — malformed index (exit 1, no crash)
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI resolve — malformed index', () => {
  it('exit 1 with INVALID_EFFECTIVE_INDEX for null provider', () => {
    const malformed = {
      schemaVersion: 1,
      inputs: {
        catalogs: [{ id: 'test', version: '1.0.0', contentHash: 'sha256:' + 'a'.repeat(64) }],
        projectContentHash: 'sha256:' + 'b'.repeat(64),
      },
      entries: [
        {
          ref: 'test.entry',
          provider: null,
          kind: 'workflow',
          summary: 'Test',
          match: { domains: ['d'], artifactTypes: ['t'], intents: ['i'] },
          accepts: ['a'],
          produces: ['p'],
          sideEffects: ['read-only'],
          provenance: { sourceCatalog: 'test' },
        },
      ],
      disabledEntries: [],
    };
    const badPath = join(tmpDir, 'malformed-resolve.json');
    writeFileSync(badPath, JSON.stringify(malformed));
    const { exitCode, envelope, stdout } = runCli([
      'resolve',
      '--index', badPath,
      '--ref', 'test.entry',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('INVALID_EFFECTIVE_INDEX');
    assertSingleJson(stdout);
  });

  it('exit 1 for index missing required top-level fields', () => {
    const malformed = { schemaVersion: 1, entries: [{ ref: 'x' }] };
    const badPath = join(tmpDir, 'missing-fields.json');
    writeFileSync(badPath, JSON.stringify(malformed));
    const { exitCode, envelope } = runCli([
      'resolve',
      '--index', badPath,
      '--ref', 'x',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('INVALID_EFFECTIVE_INDEX');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE — usage errors (exit 2)
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI resolve — usage errors', () => {
  it('exit 2 for bare --ref (no value)', () => {
    const { exitCode, envelope } = runCli([
      'resolve', '--index', FIXTURE_INDEX, '--ref', '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for missing --host', () => {
    const { exitCode, envelope } = runCli([
      'resolve', '--index', FIXTURE_INDEX, '--ref', 'artifact.prd-feature.author',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for extra positional arg', () => {
    const { exitCode, envelope } = runCli([
      'resolve', '--index', FIXTURE_INDEX, '--ref', 'r', '--host', 'claude-code', 'extra',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE JSON OUTPUT — all commands produce exactly one JSON document
// ═══════════════════════════════════════════════════════════════════════════

describe('dist CLI — single JSON stdout', () => {
  it('query success produces single JSON', () => {
    const { stdout } = runCli(['query', '--index', FIXTURE_INDEX]);
    assertSingleJson(stdout);
  });

  it('query error produces single JSON', () => {
    const { stdout } = runCli(['query', '--index', '/nonexistent/x.json']);
    assertSingleJson(stdout);
  });

  it('resolve success produces single JSON', () => {
    const pluginRoot = resolve(PROVIDER_ROOTS, 'artifact-chain-assistant');
    const { stdout } = runCli([
      'resolve', '--index', FIXTURE_INDEX,
      '--ref', 'artifact.prd-feature.author',
      '--host', 'claude-code',
      '--plugin-root', pluginRoot,
    ]);
    assertSingleJson(stdout);
  });

  it('usage error produces single JSON', () => {
    const { stdout } = runCli(['query']);
    assertSingleJson(stdout);
  });
});
