import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEffectiveIndex } from '../src/resolver/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const FIXTURE_INDEX = resolve(import.meta.dirname, '..', 'test-fixtures', 'effective-index.json');
const PROVIDER_ROOTS = resolve(import.meta.dirname, '..', 'test-fixtures', 'provider-roots');

// Inline catalog fixtures for test-local index construction
const CATALOG_PLUGIN = {
  schemaVersion: 1,
  catalog: { id: 'test-cat', version: '1.0.0' },
  entries: [
    {
      ref: 'test-cat.entity.author',
      provider: { scope: 'plugin' as const, plugin: 'test-cat', skill: 'author-skill' },
      kind: 'workflow' as const,
      summary: 'Author entity workflow',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['author'] },
      accepts: ['objective'],
      produces: ['artifact'],
      sideEffects: ['write-project-artifacts'],
    },
    {
      ref: 'test-cat.entity.validate',
      provider: { scope: 'plugin' as const, plugin: 'test-cat', skill: 'validate-skill' },
      kind: 'operation' as const,
      summary: 'Validate entity operation',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['validate'] },
      accepts: ['artifact'],
      produces: ['validation-result'],
      sideEffects: ['read-only'],
    },
    {
      ref: 'test-cat.doc.author',
      provider: { scope: 'plugin' as const, plugin: 'test-cat', skill: 'doc-skill' },
      kind: 'workflow' as const,
      summary: 'Author doc workflow',
      match: { domains: ['docs'], artifactTypes: ['doc'], intents: ['author'] },
      accepts: ['spec'],
      produces: ['doc'],
      sideEffects: ['write-project-artifacts'],
    },
  ],
};

const CATALOG_SECOND = {
  schemaVersion: 1,
  catalog: { id: 'second-cat', version: '1.0.0' },
  entries: [
    {
      ref: 'second-cat.entity.author',
      provider: { scope: 'plugin' as const, plugin: 'second-cat', skill: 'second-author-skill' },
      kind: 'workflow' as const,
      summary: 'Second author workflow',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['author'] },
      accepts: ['objective'],
      produces: ['artifact'],
      sideEffects: ['write-project-artifacts'],
    },
  ],
};

const PROJECT_OVERLAY = {
  schemaVersion: 1,
  entries: [
    {
      ref: 'project-local.tool.audit',
      provider: { scope: 'project' as const, skill: 'tool-audit-skill' },
      kind: 'workflow' as const,
      summary: 'Audit tool with project rules',
      match: { domains: ['tool'], artifactTypes: ['config'], intents: ['audit'] },
      accepts: ['objective'],
      produces: ['audit-result'],
      sideEffects: ['read-only'],
    },
  ],
};

// Build an effective index in-memory
function buildTestIndex(catalogs: unknown[] = [CATALOG_PLUGIN], project?: unknown) {
  const result = buildEffectiveIndex({ catalogs, project });
  if (!result.ok) throw new Error(`Failed to build index: ${result.diagnostics.map(d => d.message).join(', ')}`);
  return result.index!;
}

// Write index to a temp file
function writeIndexFile(index: object, tmpDir: string, name = 'effective-index.json'): string {
  const path = join(tmpDir, name);
  writeFileSync(path, JSON.stringify(index, null, 2) + '\n');
  return path;
}

let cli: typeof import('../src/cli.js');

beforeEach(async () => {
  cli = await import('../src/cli.js');
});

// Helper: run CLI and capture output/exitCode
function captureRun(argv: string[]): { stdout: string; exitCode: number | undefined; envelope: any } {
  let stdout = '';
  let exitCode: number | undefined;
  const originalWrite = process.stdout.write;
  const originalExit = process.exit;
  // @ts-expect-error mock
  process.stdout.write = (chunk: unknown) => { stdout += String(chunk); return true; };
  // @ts-expect-error mock
  process.exit = ((code: number) => { exitCode = code; return undefined as never; }) as typeof process.exit;
  try {
    cli.run(argv);
  } catch (e) {
    if (!(e instanceof cli.ExitError)) throw e;
  } finally {
    process.stdout.write = originalWrite;
    process.exit = originalExit;
  }
  let envelope: any;
  try { envelope = JSON.parse(stdout); } catch { envelope = null; }
  return { stdout, exitCode, envelope };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY COMMAND TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('CLI query — compact success and deterministic ordering', () => {
  let tmpDir: string;
  let indexPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-query-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    const index = buildTestIndex([CATALOG_PLUGIN, CATALOG_SECOND]);
    indexPath = writeIndexFile(index, tmpDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('compact query returns ok:true with entries sorted by ref', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath,
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.entries)).toBe(true);
    // Deterministic ordering: sorted by ref
    const refs = envelope.data.entries.map((e: any) => e.ref);
    expect(refs).toEqual([...refs].sort());
  });

  it('compact entries have exactly ref, kind, summary', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath,
    ]);
    for (const entry of envelope.data.entries) {
      expect(Object.keys(entry).sort()).toEqual(['kind', 'ref', 'summary']);
    }
  });

  it('default limit is 8', () => {
    // Build a large index
    const largeCatalog = {
      schemaVersion: 1,
      catalog: { id: 'large-cat', version: '1.0.0' },
      entries: Array.from({ length: 12 }, (_, i) => ({
        ref: `large-cat.entry.${String(i).padStart(3, '0')}`,
        provider: { scope: 'plugin' as const, plugin: 'large-cat', skill: `skill-${i}` },
        kind: (i % 2 === 0 ? 'workflow' : 'operation') as 'workflow' | 'operation',
        summary: `Entry ${i}`,
        match: { domains: ['test'], artifactTypes: ['thing'], intents: ['do'] },
        accepts: ['input'],
        produces: ['output'],
        sideEffects: ['read-only'],
      })),
    };
    const index = buildTestIndex([largeCatalog]);
    const largePath = writeIndexFile(index, tmpDir, 'large-index.json');

    const { envelope } = captureRun(['node', 'cli.js', 'query', '--index', largePath]);
    expect(envelope.data.entries).toHaveLength(8);
  });
});

describe('CLI query — optional filters and AND semantics', () => {
  let tmpDir: string;
  let indexPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-query-filter-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const index = buildTestIndex([CATALOG_PLUGIN]);
    indexPath = writeIndexFile(index, tmpDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('filter by domain', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath, '--domain', 'docs',
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toHaveLength(1);
    expect(envelope.data.entries[0].ref).toBe('test-cat.doc.author');
  });

  it('filter by artifact-type', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath, '--artifact-type', 'entity',
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toHaveLength(2);
  });

  it('filter by intent', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath, '--intent', 'validate',
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toHaveLength(1);
    expect(envelope.data.entries[0].ref).toBe('test-cat.entity.validate');
  });

  it('filter by kind', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath, '--kind', 'workflow',
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toHaveLength(2);
    for (const e of envelope.data.entries) expect(e.kind).toBe('workflow');
  });

  it('AND semantics: domain + kind + artifact-type', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath,
      '--domain', 'artifact', '--kind', 'workflow', '--artifact-type', 'entity',
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toHaveLength(1);
    expect(envelope.data.entries[0].ref).toBe('test-cat.entity.author');
  });
});

describe('CLI query — explicit no-match success', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-query-nomatch-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('no-match returns ok:true with empty entries and NO_QUERY_MATCH info diagnostic', () => {
    const index = buildTestIndex([CATALOG_PLUGIN]);
    const indexPath = writeIndexFile(index, tmpDir);
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath, '--domain', 'nonexistent',
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toEqual([]);
    expect(envelope.diagnostics).toHaveLength(1);
    expect(envelope.diagnostics[0].code).toBe('NO_QUERY_MATCH');
    expect(envelope.diagnostics[0].severity).toBe('info');
  });
});

describe('CLI query — full format', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-query-full-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('full format returns complete entries with provider, match, provenance', () => {
    const index = buildTestIndex([CATALOG_PLUGIN]);
    const indexPath = writeIndexFile(index, tmpDir);
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath, '--format', 'full',
    ]);
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

describe('CLI query — limit boundaries', () => {
  let tmpDir: string;
  let largePath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-query-limit-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const largeCatalog = {
      schemaVersion: 1,
      catalog: { id: 'limit-cat', version: '1.0.0' },
      entries: Array.from({ length: 10 }, (_, i) => ({
        ref: `limit-cat.entry.${String(i).padStart(3, '0')}`,
        provider: { scope: 'plugin' as const, plugin: 'limit-cat', skill: `skill-${i}` },
        kind: 'workflow' as const,
        summary: `Entry ${i}`,
        match: { domains: ['test'], artifactTypes: ['thing'], intents: ['do'] },
        accepts: ['input'],
        produces: ['output'],
        sideEffects: ['read-only'],
      })),
    };
    const index = buildTestIndex([largeCatalog]);
    largePath = writeIndexFile(index, tmpDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('limit=1 returns exactly 1 entry', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', largePath, '--limit', '1',
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toHaveLength(1);
  });

  it('limit=8 returns at most 8 entries', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', largePath, '--limit', '8',
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entries).toHaveLength(8);
  });
});

describe('CLI query — index errors', () => {
  it('exit 1 for missing index file', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', '/nonexistent/index.json',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('INPUT_READ_FAILED');
  });

  it('exit 1 for malformed JSON index', () => {
    const tmpDir = join(tmpdir(), `cli-query-bad-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const badPath = join(tmpDir, 'bad-index.json');
    writeFileSync(badPath, '{invalid json');
    try {
      const { exitCode, envelope } = captureRun([
        'node', 'cli.js', 'query', '--index', badPath,
      ]);
      expect(exitCode).toBe(1);
      expect(envelope.ok).toBe(false);
      expect(envelope.diagnostics[0].code).toBe('INPUT_READ_FAILED');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('exit 1 for stale/invalid effective index', () => {
    const tmpDir = join(tmpdir(), `cli-query-stale-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const stalePath = join(tmpDir, 'stale-index.json');
    writeFileSync(stalePath, JSON.stringify({ bad: 'index' }));
    try {
      const { exitCode, envelope } = captureRun([
        'node', 'cli.js', 'query', '--index', stalePath,
      ]);
      expect(exitCode).toBe(1);
      expect(envelope.ok).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('CLI query — flag validation errors (exit 2)', () => {
  it('exit 2 for missing --index flag', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for duplicate --index flag', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', 'a.json', '--index', 'b.json',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for invalid kind value', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', 'x.json', '--kind', 'badkind',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for invalid format value', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', 'x.json', '--format', 'yaml',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for non-integer limit', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', 'x.json', '--limit', 'abc',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for limit out of range (0)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', 'x.json', '--limit', '0',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for limit out of range (9)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', 'x.json', '--limit', '9',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for unknown flag', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', 'x.json', '--bogus', 'value',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RESOLVE COMMAND TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('CLI resolve — plugin resolve success with one root', () => {
  let tmpDir: string;
  let indexPath: string;
  const pluginRoot = resolve(PROVIDER_ROOTS, 'artifact-chain-assistant');

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-plugin-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    // Read the fixture index
    indexPath = FIXTURE_INDEX;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('plugin resolve succeeds with verified status', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
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
    expect(envelope.data.entry.provider.skill).toBe('prd-feature-flow-author');
    expect(envelope.data.verification.status).toBe('verified');
    expect(envelope.data.verification.host).toBe('claude-code');
    expect(Array.isArray(envelope.data.verification.diagnostics)).toBe(true);
  });

  it('provider remains at data.entry.provider (not duplicated)', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'artifact.prd-feature.author',
      '--host', 'claude-code',
      '--plugin-root', pluginRoot,
    ]);
    // Provider must be inside entry, not at top-level data
    expect(envelope.data.entry.provider).toBeDefined();
    expect(envelope.data.provider).toBeUndefined();
  });
});

describe('CLI resolve — project resolve success', () => {
  let tmpDir: string;
  let indexPath: string;
  let projectRoot: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-project-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    // Build an index with a project entry
    const index = buildTestIndex([CATALOG_PLUGIN], PROJECT_OVERLAY);
    indexPath = writeIndexFile(index, tmpDir);
    // Create project provider SKILL.md
    projectRoot = join(tmpDir, 'project-root');
    mkdirSync(join(projectRoot, 'tool-audit-skill'), { recursive: true });
    writeFileSync(join(projectRoot, 'tool-audit-skill', 'SKILL.md'), '# tool-audit-skill');
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('project resolve succeeds', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'project-local.tool.audit',
      '--host', 'codex',
      '--project-root', projectRoot,
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.entry.ref).toBe('project-local.tool.audit');
    expect(envelope.data.entry.provider.scope).toBe('project');
    expect(envelope.data.verification.status).toBe('verified');
    expect(envelope.data.verification.host).toBe('codex');
  });
});

describe('CLI resolve — entry not found and disabled', () => {
  let tmpDir: string;
  let indexPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-entry-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    // Build index with a disabled entry
    const indexWithDisabled = buildTestIndex([CATALOG_PLUGIN], {
      schemaVersion: 1,
      disabled: ['test-cat.entity.validate'],
    });
    indexPath = writeIndexFile(indexWithDisabled, tmpDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exit 1 for entry not found', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'nonexistent.ref',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('ENTRY_NOT_FOUND');
  });

  it('exit 1 for disabled entry', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'test-cat.entity.validate',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('ENTRY_DISABLED');
  });
});

describe('CLI resolve — provider not found, ambiguous, unverified', () => {
  let tmpDir: string;
  let indexPath: string;
  let providerRoot: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-provider-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const index = buildTestIndex([CATALOG_PLUGIN]);
    indexPath = writeIndexFile(index, tmpDir);
    providerRoot = join(tmpDir, 'providers');
    mkdirSync(providerRoot, { recursive: true });
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exit 1 for provider not found (no SKILL.md)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'test-cat.entity.author',
      '--host', 'claude-code',
      '--plugin-root', providerRoot,
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('PROVIDER_NOT_FOUND');
  });

  it('exit 1 for ambiguous provider (multiple canonical hits)', () => {
    // Create two distinct roots with same skill
    const root1 = join(providerRoot, 'root1');
    const root2 = join(providerRoot, 'root2');
    mkdirSync(join(root1, 'author-skill'), { recursive: true });
    writeFileSync(join(root1, 'author-skill', 'SKILL.md'), '# root1');
    mkdirSync(join(root2, 'author-skill'), { recursive: true });
    writeFileSync(join(root2, 'author-skill', 'SKILL.md'), '# root2');

    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'test-cat.entity.author',
      '--host', 'claude-code',
      '--plugin-root', root1,
      '--plugin-root', root2,
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('AMBIGUOUS_PROVIDER');
  });

  it('exit 1 for provider not found (root provided but SKILL.md missing)', () => {
    // Root provided (mapped to plugin ID) but no SKILL.md in it
    const emptyRoot = join(providerRoot, 'empty-root');
    mkdirSync(emptyRoot, { recursive: true });

    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'test-cat.entity.author',
      '--host', 'claude-code',
      '--plugin-root', emptyRoot,
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('PROVIDER_NOT_FOUND');
  });
});

describe('CLI resolve — host validation', () => {
  let tmpDir: string;
  let indexPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-host-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const index = buildTestIndex([CATALOG_PLUGIN]);
    indexPath = writeIndexFile(index, tmpDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exit 2 for missing --host flag', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'test-cat.entity.author',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for invalid --host value', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'test-cat.entity.author',
      '--host', 'invalid-host',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

describe('CLI resolve — repeated roots serialized correctly', () => {
  let tmpDir: string;
  let indexPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-roots-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const index = buildTestIndex([CATALOG_PLUGIN]);
    indexPath = writeIndexFile(index, tmpDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('multiple --plugin-root values are all passed to verification', () => {
    const root1 = join(tmpDir, 'root1');
    const root2 = join(tmpDir, 'root2');
    // Only root2 has the SKILL.md
    mkdirSync(join(root2, 'author-skill'), { recursive: true });
    writeFileSync(join(root2, 'author-skill', 'SKILL.md'), '# root2');
    mkdirSync(root1, { recursive: true });

    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'test-cat.entity.author',
      '--host', 'claude-code',
      '--plugin-root', root1,
      '--plugin-root', root2,
    ]);
    // Should find the provider in root2
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.verification.status).toBe('verified');
  });
});

describe('CLI resolve — content hashes match effective-index inputs', () => {
  let tmpDir: string;
  let indexPath: string;
  const pluginRoot = resolve(PROVIDER_ROOTS, 'artifact-chain-assistant');

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-hash-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    indexPath = FIXTURE_INDEX;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('index_content_hashes catalogs and project match the effective index inputs', () => {
    const { envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', indexPath,
      '--ref', 'artifact.prd-feature.author',
      '--host', 'claude-code',
      '--plugin-root', pluginRoot,
    ]);
    expect(envelope.ok).toBe(true);
    const hashes = envelope.data.index_content_hashes;
    expect(hashes).toBeDefined();
    expect(hashes.catalogs).toBeDefined();
    expect(typeof hashes.catalogs['artifact-chain-assistant']).toBe('string');
    expect(hashes.catalogs['artifact-chain-assistant']).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof hashes.project).toBe('string');
    expect(hashes.project).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('CLI resolve — flag validation errors (exit 2)', () => {
  it('exit 2 for missing --index', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--ref', 'x', '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for missing --ref', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', 'x.json', '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for duplicate --index', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', 'a.json', '--index', 'b.json',
      '--ref', 'x', '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for duplicate --ref', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', 'a.json',
      '--ref', 'x', '--ref', 'y', '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for duplicate --host', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', 'a.json',
      '--ref', 'x', '--host', 'claude-code', '--host', 'codex',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for unknown flag', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', 'a.json',
      '--ref', 'x', '--host', 'claude-code', '--bogus', 'val',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EXIT CODE + ENVELOPE CONSISTENCY
// ═══════════════════════════════════════════════════════════════════════════

describe('CLI exit code and envelope consistency', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-exit-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exit 0 always has ok:true envelope', () => {
    const index = buildTestIndex([CATALOG_PLUGIN]);
    const indexPath = writeIndexFile(index, tmpDir);
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath,
    ]);
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
  });

  it('exit 1 always has ok:false envelope with diagnostics', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', '/nonexistent/x.json',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(Array.isArray(envelope.diagnostics)).toBe(true);
    expect(envelope.diagnostics.length).toBeGreaterThan(0);
  });

  it('exit 2 always has ok:false envelope with CLI_USAGE_ERROR', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('stdout is exactly one JSON document (no trailing text)', () => {
    const index = buildTestIndex([CATALOG_PLUGIN]);
    const indexPath = writeIndexFile(index, tmpDir);
    const { stdout } = captureRun([
      'node', 'cli.js', 'query', '--index', indexPath,
    ]);
    // Should parse as single JSON
    const parsed = JSON.parse(stdout);
    expect(parsed).toBeDefined();
    // Check there's no extra text after the JSON
    const trimmed = stdout.trimEnd();
    expect(trimmed).toBe(JSON.stringify(parsed));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MALFORMED CLI INVOCATIONS — Issue III
// All must be CLI_USAGE_ERROR exit 2, not misclassified as data errors
// ═══════════════════════════════════════════════════════════════════════════

describe('CLI malformed invocations — bare/empty singleton flags (exit 2)', () => {
  it('exit 2 for query --index (bare, no value)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for resolve --index X --ref --host claude-code (bare --ref)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', '/tmp/x.json', '--ref', '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for resolve --index X --ref r --host (bare --host)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', '/tmp/x.json', '--ref', 'r', '--host',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for query --domain (bare filter flag)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', '/tmp/x.json', '--domain',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for resolve --plugin-root (bare repeated flag)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', '/tmp/x.json', '--ref', 'r', '--host', 'claude-code', '--plugin-root',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

describe('CLI malformed invocations — extra positional args (exit 2)', () => {
  it('exit 2 for query --index X stray (extra positional)', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'query', '--index', '/tmp/x.json', 'stray',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 2 for resolve with extra positional', () => {
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve', '--index', '/tmp/x.json', '--ref', 'r', '--host', 'claude-code', 'extra',
    ]);
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MALFORMED INDEX IN RESOLVE — Issue II
// Must produce structured INVALID_EFFECTIVE_INDEX, not crash
// ═══════════════════════════════════════════════════════════════════════════

describe('CLI resolve — malformed index (no crash, structured diagnostic)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-resolve-malformed-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exit 1 with INVALID_EFFECTIVE_INDEX for index with matching ref but missing provider', () => {
    // Index has entries array and matching ref, but provider is null
    const malformed = {
      schemaVersion: 1,
      inputs: {
        catalogs: [{ id: 'test', version: '1.0.0', contentHash: 'sha256:' + 'a'.repeat(64) }],
        projectContentHash: 'sha256:' + 'b'.repeat(64),
      },
      entries: [
        {
          ref: 'test.entry',
          provider: null, // malformed
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
    const badPath = join(tmpDir, 'malformed-index.json');
    writeFileSync(badPath, JSON.stringify(malformed));

    // Must not throw — should return structured error
    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', badPath,
      '--ref', 'test.entry',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(Array.isArray(envelope.diagnostics)).toBe(true);
    expect(envelope.diagnostics.length).toBeGreaterThan(0);
    // Should be INVALID_EFFECTIVE_INDEX from schema validation
    expect(envelope.diagnostics[0].code).toBe('INVALID_EFFECTIVE_INDEX');
  });

  it('exit 1 with INVALID_EFFECTIVE_INDEX for index with missing provider field entirely', () => {
    const malformed = {
      schemaVersion: 1,
      inputs: {
        catalogs: [{ id: 'test', version: '1.0.0', contentHash: 'sha256:' + 'a'.repeat(64) }],
        projectContentHash: 'sha256:' + 'b'.repeat(64),
      },
      entries: [
        {
          ref: 'test.entry',
          // provider is missing entirely
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
    const badPath = join(tmpDir, 'no-provider-index.json');
    writeFileSync(badPath, JSON.stringify(malformed));

    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', badPath,
      '--ref', 'test.entry',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('INVALID_EFFECTIVE_INDEX');
  });

  it('exit 1 with INVALID_EFFECTIVE_INDEX for index missing required top-level fields', () => {
    const malformed = {
      schemaVersion: 1,
      entries: [{ ref: 'x', provider: { scope: 'plugin', plugin: 'p', skill: 's' } }],
      // missing inputs and disabledEntries
    };
    const badPath = join(tmpDir, 'missing-fields-index.json');
    writeFileSync(badPath, JSON.stringify(malformed));

    const { exitCode, envelope } = captureRun([
      'node', 'cli.js', 'resolve',
      '--index', badPath,
      '--ref', 'x',
      '--host', 'claude-code',
    ]);
    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0].code).toBe('INVALID_EFFECTIVE_INDEX');
  });
});
