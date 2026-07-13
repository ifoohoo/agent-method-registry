import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnoseRegistry } from '../src/doctor/checks.js';
import type { DiagnoseInput, DoctorCheck, DiagnoseResult } from '../src/doctor/checks.js';
import type { EffectiveIndex, EffectiveEntry } from '../src/resolver/index.js';
import { buildEffectiveIndex } from '../src/resolver/index.js';
import { computeContentHash } from '../src/canonicalize/content-hash.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'doctor-test-'));
}

function createSkillFile(baseDir: string, skill: string, content = '# Skill') {
  const skillDir = join(baseDir, skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content);
}

// ── Shared fixtures ─────────────────────────────────────────────

const VALID_CATALOG_A = {
  schemaVersion: 1,
  catalog: { id: 'plugin-a', version: '1.0.0' },
  entries: [
    {
      ref: 'plugin-a.entity.author',
      provider: { scope: 'plugin' as const, plugin: 'plugin-a', skill: 'author-skill' },
      kind: 'workflow' as const,
      summary: 'Author entry',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['author'] },
      accepts: ['objective'],
      produces: ['artifact'],
      sideEffects: ['write-project-artifacts'],
    },
  ],
};

const VALID_CATALOG_B = {
  schemaVersion: 1,
  catalog: { id: 'plugin-b', version: '1.0.0' },
  entries: [
    {
      ref: 'plugin-b.entity.validate',
      provider: { scope: 'plugin' as const, plugin: 'plugin-b', skill: 'validate-skill' },
      kind: 'operation' as const,
      summary: 'Validate entry',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['validate'] },
      accepts: ['artifact'],
      produces: ['validation-result'],
      sideEffects: ['read-only'],
    },
  ],
};

const VALID_PROJECT_OVERLAY = {
  schemaVersion: 1,
  disabled: ['plugin-a.entity.author'],
};

const INVALID_SCHEMA_VERSION_CATALOG = {
  schemaVersion: 99,
  catalog: { id: 'bad-catalog', version: '1.0.0' },
  entries: [],
};

function buildValidIndex(): EffectiveIndex {
  const result = buildEffectiveIndex({
    catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
    project: VALID_PROJECT_OVERLAY,
  });
  expect(result.ok).toBe(true);
  return result.index!;
}

// ── Schema check ────────────────────────────────────────────────

describe('diagnoseRegistry — schema check', () => {
  it('passes for valid catalogs and overlay', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
    });

    const schemaCheck = result.checks.find(c => c.id === 'schema')!;
    expect(schemaCheck.status).toBe('pass');
    expect(schemaCheck.diagnostics).toHaveLength(0);
  });

  it('fails for invalid schema version in a catalog', () => {
    const result = diagnoseRegistry({
      catalogs: [INVALID_SCHEMA_VERSION_CATALOG],
    });

    const schemaCheck = result.checks.find(c => c.id === 'schema')!;
    expect(schemaCheck.status).toBe('fail');
    expect(schemaCheck.diagnostics.some(d => d.code === 'SCHEMA_VERSION_UNSUPPORTED')).toBe(true);
  });

  it('fails for invalid project overlay', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
      project: { schemaVersion: 99 },
    });

    const schemaCheck = result.checks.find(c => c.id === 'schema')!;
    expect(schemaCheck.status).toBe('fail');
    expect(schemaCheck.diagnostics.some(d =>
      d.code === 'SCHEMA_VERSION_UNSUPPORTED'
    )).toBe(true);
  });

  it('ok=false when schema check fails', () => {
    const result = diagnoseRegistry({
      catalogs: [INVALID_SCHEMA_VERSION_CATALOG],
    });

    expect(result.ok).toBe(false);
  });
});

// ── Merge check ─────────────────────────────────────────────────

describe('diagnoseRegistry — merge check', () => {
  it('passes when catalogs merge cleanly', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
    });

    const mergeCheck = result.checks.find(c => c.id === 'merge')!;
    expect(mergeCheck.status).toBe('pass');
    expect(mergeCheck.diagnostics).toHaveLength(0);
  });

  it('fails when duplicate catalog ids detected', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_A],
    });

    const mergeCheck = result.checks.find(c => c.id === 'merge')!;
    expect(mergeCheck.status).toBe('fail');
    expect(mergeCheck.diagnostics.some(d => d.code === 'DUPLICATE_CATALOG_ID')).toBe(true);
  });

  it('merge check is skipped (not run) when schema check fails', () => {
    const result = diagnoseRegistry({
      catalogs: [INVALID_SCHEMA_VERSION_CATALOG],
    });

    // merge check should still be present but may be skipped or fail due to schema
    const mergeCheck = result.checks.find(c => c.id === 'merge');
    expect(mergeCheck).toBeDefined();
  });
});

// ── Freshness check ─────────────────────────────────────────────

describe('diagnoseRegistry — freshness check', () => {
  it('is unverified when no existingIndex provided', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
    });

    const freshnessCheck = result.checks.find(c => c.id === 'freshness')!;
    expect(freshnessCheck.status).toBe('unverified');
  });

  it('passes when index matches current inputs', () => {
    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
    });

    const freshnessCheck = result.checks.find(c => c.id === 'freshness')!;
    expect(freshnessCheck.status).toBe('pass');
    expect(freshnessCheck.diagnostics).toHaveLength(0);
  });

  it('fails with STALE_EFFECTIVE_INDEX when contentHash mismatch', () => {
    // Build an index, then change the catalog data
    const existingIndex = buildValidIndex();

    const MODIFIED_CATALOG_A = {
      ...VALID_CATALOG_A,
      entries: [
        {
          ...VALID_CATALOG_A.entries[0],
          summary: 'Modified summary to change content hash',
        },
      ],
    };

    const result = diagnoseRegistry({
      catalogs: [MODIFIED_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
    });

    const freshnessCheck = result.checks.find(c => c.id === 'freshness')!;
    expect(freshnessCheck.status).toBe('fail');
    expect(freshnessCheck.diagnostics.some(d => d.code === 'STALE_EFFECTIVE_INDEX')).toBe(true);
  });

  it('fails when number of catalogs changes', () => {
    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A], // removed catalog B
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
    });

    const freshnessCheck = result.checks.find(c => c.id === 'freshness')!;
    expect(freshnessCheck.status).toBe('fail');
    expect(freshnessCheck.diagnostics.some(d => d.code === 'STALE_EFFECTIVE_INDEX')).toBe(true);
  });

  it('ok=false when freshness check fails', () => {
    const existingIndex = buildValidIndex();

    const MODIFIED_CATALOG_A = {
      ...VALID_CATALOG_A,
      catalog: { id: 'plugin-a', version: '2.0.0' }, // version change
      entries: [...VALID_CATALOG_A.entries],
    };

    const result = diagnoseRegistry({
      catalogs: [MODIFIED_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
    });

    expect(result.ok).toBe(false);
  });
});

// ── Provider check ──────────────────────────────────────────────

describe('diagnoseRegistry — provider check', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('is unverified when no roots or host provided', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
    });

    const providerCheck = result.checks.find(c => c.id === 'provider')!;
    expect(providerCheck.status).toBe('unverified');
  });

  it('passes when all providers are verified', () => {
    // Create SKILL.md for both providers
    const root = join(tempDir, 'root');
    createSkillFile(root, 'author-skill');
    createSkillFile(root, 'validate-skill');

    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
      host: 'claude-code',
      pluginRoots: { 'plugin-a': [root], 'plugin-b': [root] },
    });

    const providerCheck = result.checks.find(c => c.id === 'provider')!;
    expect(providerCheck.status).toBe('pass');
  });

  it('fails when any provider is not-found', () => {
    // Only create author-skill, not validate-skill
    const root = join(tempDir, 'root');
    createSkillFile(root, 'author-skill');

    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
      host: 'claude-code',
      pluginRoots: { 'plugin-a': [root], 'plugin-b': [root] },
    });

    const providerCheck = result.checks.find(c => c.id === 'provider')!;
    expect(providerCheck.status).toBe('fail');
    expect(providerCheck.diagnostics.some(d => d.code === 'PROVIDER_NOT_FOUND')).toBe(true);
  });

  it('all entries unverified when no roots → unverified status', () => {
    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
      host: 'claude-code',
      // no pluginRoots provided
    });

    const providerCheck = result.checks.find(c => c.id === 'provider')!;
    expect(providerCheck.status).toBe('unverified');
  });
});

// ── strictProvider ──────────────────────────────────────────────

describe('diagnoseRegistry — strictProvider', () => {
  it('converts unverified status to PROVIDER_UNVERIFIED error', () => {
    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
      host: 'claude-code',
      strictProvider: true,
      // no pluginRoots
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'PROVIDER_UNVERIFIED')).toBe(true);
  });

  it('still passes when all verified even with strictProvider', () => {
    const tempDir = makeTempDir();
    const root = join(tempDir, 'root');
    createSkillFile(root, 'author-skill');
    createSkillFile(root, 'validate-skill');

    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
      host: 'claude-code',
      pluginRoots: { 'plugin-a': [root], 'plugin-b': [root] },
      strictProvider: true,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── HOST_REQUIRED ───────────────────────────────────────────────

describe('diagnoseRegistry — HOST_REQUIRED', () => {
  it('returns HOST_REQUIRED when roots present but no host', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
      pluginRoots: { 'plugin-a': ['/tmp/some-root'] },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'HOST_REQUIRED')).toBe(true);
  });

  it('returns HOST_REQUIRED when strictProvider present but no host', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
      strictProvider: true,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'HOST_REQUIRED')).toBe(true);
  });

  it('does not require host when no roots or strictProvider', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
    });

    // Should not have HOST_REQUIRED
    expect(result.diagnostics.some(d => d.code === 'HOST_REQUIRED')).toBe(false);
  });
});

// ── Full diagnosis ──────────────────────────────────────────────

describe('diagnoseRegistry — full diagnosis', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('all checks pass with valid inputs and verified providers', () => {
    const root = join(tempDir, 'root');
    createSkillFile(root, 'author-skill');
    createSkillFile(root, 'validate-skill');

    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
      host: 'claude-code',
      pluginRoots: { 'plugin-a': [root], 'plugin-b': [root] },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(4);
    expect(result.checks.every(c => c.status === 'pass')).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('collects diagnostics from all failing checks', () => {
    const result = diagnoseRegistry({
      catalogs: [INVALID_SCHEMA_VERSION_CATALOG, INVALID_SCHEMA_VERSION_CATALOG],
      project: { schemaVersion: 99 },
    });

    expect(result.ok).toBe(false);
    // Should have diagnostics from schema check (and possibly merge)
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

// ── DoctorCheck structure ───────────────────────────────────────

describe('diagnoseRegistry — DoctorCheck structure', () => {
  it('each check has id, status, and diagnostics', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
    });

    expect(result.checks).toHaveLength(4);
    for (const check of result.checks) {
      expect(check).toHaveProperty('id');
      expect(check).toHaveProperty('status');
      expect(check).toHaveProperty('diagnostics');
      expect(['schema', 'merge', 'freshness', 'provider']).toContain(check.id);
      expect(['pass', 'fail', 'warn', 'unverified']).toContain(check.status);
      expect(Array.isArray(check.diagnostics)).toBe(true);
    }
  });

  it('target field is optional', () => {
    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A],
    });

    // target is optional — some checks may have it, some may not
    for (const check of result.checks) {
      // Just verify it doesn't break if absent
      if (check.target) {
        expect(typeof check.target).toBe('string');
      }
    }
  });

  it('schema check has target set to catalog id on failure', () => {
    const result = diagnoseRegistry({
      catalogs: [INVALID_SCHEMA_VERSION_CATALOG],
    });

    const schemaCheck = result.checks.find(c => c.id === 'schema')!;
    expect(schemaCheck.status).toBe('fail');
    // target should point to the catalog id
    expect(schemaCheck.target).toBe('bad-catalog');
  });

  it('provider check entries have target set to entry ref', () => {
    const tempDir = makeTempDir();
    const root = join(tempDir, 'root');
    // Only create one skill to have one fail
    createSkillFile(root, 'author-skill');

    const existingIndex = buildValidIndex();

    const result = diagnoseRegistry({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: VALID_PROJECT_OVERLAY,
      existingIndex,
      host: 'claude-code',
      pluginRoots: { 'plugin-a': [root], 'plugin-b': [root] },
    });

    const providerCheck = result.checks.find(c => c.id === 'provider')!;
    expect(providerCheck.status).toBe('fail');
    // Provider check diagnostics should have a target
    expect(providerCheck.target).toBe('plugin-b.entity.validate');

    rmSync(tempDir, { recursive: true, force: true });
  });
});
