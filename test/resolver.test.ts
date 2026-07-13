import { describe, it, expect } from 'vitest';
import { buildEffectiveIndex } from '../src/resolver/index.js';
import type { EffectiveIndex } from '../src/resolver/index.js';
import type { Diagnostic } from '../src/errors/codes.js';

// ── Shared test fixtures ────────────────────────────────────────

const VALID_CATALOG_A = {
  schemaVersion: 1,
  catalog: { id: 'plugin-a', version: '1.0.0' },
  entries: [
    {
      ref: 'plugin-a.entity.author',
      provider: { scope: 'plugin', plugin: 'plugin-a', skill: 'author-skill' },
      kind: 'workflow',
      summary: 'Author entry',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['author'] },
      accepts: ['objective'],
      produces: ['artifact'],
      sideEffects: ['write-project-artifacts'],
    },
    {
      ref: 'plugin-a.entity.validate',
      provider: { scope: 'plugin', plugin: 'plugin-a', skill: 'validate-skill' },
      kind: 'operation',
      summary: 'Validate entry',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['validate'] },
      accepts: ['artifact'],
      produces: ['validation-result'],
      sideEffects: ['read-only'],
    },
  ],
};

const VALID_CATALOG_B = {
  schemaVersion: 1,
  catalog: { id: 'plugin-b', version: '0.1.0' },
  entries: [
    {
      ref: 'plugin-b.entity.deploy',
      provider: { scope: 'plugin', plugin: 'plugin-b', skill: 'deploy-skill' },
      kind: 'workflow',
      summary: 'Deploy entry',
      match: { domains: ['deploy'], artifactTypes: ['manifest'], intents: ['deploy'] },
      accepts: ['manifest'],
      produces: ['deployment'],
      sideEffects: ['external-state-change'],
    },
  ],
};

// ── Single catalog ─────────────────────────────────────────────

describe('buildEffectiveIndex — single catalog', () => {
  it('builds effective index correctly from a single valid catalog', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A] });
    expect(result.ok).toBe(true);
    expect(result.index).toBeDefined();
    expect(result.index!.schemaVersion).toBe(1);
    expect(result.index!.entries).toHaveLength(2);
    expect(result.index!.disabledEntries).toHaveLength(0);
  });

  it('sets provenance.sourceCatalog from catalog.id', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A] });
    expect(result.ok).toBe(true);
    for (const entry of result.index!.entries) {
      expect(entry.provenance.sourceCatalog).toBe('plugin-a');
      expect(entry.provenance.overriddenBy).toBeUndefined();
    }
  });
});

// ── Multiple catalogs ──────────────────────────────────────────

describe('buildEffectiveIndex — multiple catalogs', () => {
  it('merges multiple catalogs with unique ids correctly', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
    });
    expect(result.ok).toBe(true);
    expect(result.index!.entries).toHaveLength(3);
    const refs = result.index!.entries.map(e => e.ref);
    expect(refs).toContain('plugin-a.entity.author');
    expect(refs).toContain('plugin-a.entity.validate');
    expect(refs).toContain('plugin-b.entity.deploy');
  });
});

// ── Catalog ID conflicts ───────────────────────────────────────

describe('buildEffectiveIndex — catalog ID conflicts', () => {
  it('rejects duplicate catalog.id', () => {
    const dupCatalog = { ...VALID_CATALOG_A };
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A, dupCatalog],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_CATALOG_ID')).toBe(true);
  });
});

// ── Duplicate default provider ─────────────────────────────────

describe('buildEffectiveIndex — duplicate default provider', () => {
  it('rejects two catalogs defining the same ref', () => {
    const catalogB = {
      ...VALID_CATALOG_B,
      entries: [
        {
          ...VALID_CATALOG_B.entries[0],
          ref: 'plugin-a.entity.author', // same ref as VALID_CATALOG_A
          provider: {
            scope: 'plugin' as const,
            plugin: 'plugin-b',
            skill: 'author-skill-b',
          },
        },
      ],
    };
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A, catalogB],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_DEFAULT_PROVIDER')).toBe(true);
  });
});

// ── Project entries ────────────────────────────────────────────

describe('buildEffectiveIndex — project entries', () => {
  it('rejects project entry ref duplicating a catalog ref', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        entries: [
          {
            ref: 'plugin-a.entity.author', // duplicates catalog ref
            provider: { scope: 'project', skill: 'proj-author' },
            kind: 'workflow',
            summary: 'Project author',
            match: { domains: ['d'], artifactTypes: ['a'], intents: ['i'] },
            accepts: ['x'],
            produces: ['y'],
            sideEffects: ['write-project-artifacts'],
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'DUPLICATE_PROJECT_ENTRY')).toBe(true);
  });

  it('accepts project entry with new ref', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        entries: [
          {
            ref: 'project.new.action',
            provider: { scope: 'project', skill: 'new-skill' },
            kind: 'operation',
            summary: 'New project entry',
            match: { domains: ['project'], artifactTypes: ['thing'], intents: ['action'] },
            accepts: ['input'],
            produces: ['output'],
            sideEffects: ['write-project-artifacts'],
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.index!.entries.some(e => e.ref === 'project.new.action')).toBe(true);
    expect(
      result.index!.entries.find(e => e.ref === 'project.new.action')!.provenance.sourceCatalog
    ).toBe('project');
  });
});

// ── Overrides ──────────────────────────────────────────────────

describe('buildEffectiveIndex — overrides', () => {
  it('rejects override targeting non-existent ref', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        overrides: {
          'nonexistent.ref': { provider: { scope: 'project', skill: 'override' } },
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'UNKNOWN_OVERRIDE_REF')).toBe(true);
  });

  it('rejects override targeting a project entry (not catalog default)', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        entries: [
          {
            ref: 'project.entry.one',
            provider: { scope: 'project', skill: 'proj-skill' },
            kind: 'workflow',
            summary: 'Project entry',
            match: { domains: ['d'], artifactTypes: ['a'], intents: ['i'] },
            accepts: ['x'],
            produces: ['y'],
            sideEffects: ['write-project-artifacts'],
          },
        ],
        overrides: {
          'project.entry.one': { provider: { scope: 'project', skill: 'override-skill' } },
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_OVERRIDE_TARGET')).toBe(true);
  });

  it('rejects override with invalid provider (plugin variant)', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        overrides: {
          'plugin-a.entity.author': {
            provider: { scope: 'project', skill: 'override-skill' },
          },
        },
      },
    });
    // This should succeed since scope: 'project' is valid
    expect(result.ok).toBe(true);
  });

  it('applies override and sets provenance.overriddenBy', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        overrides: {
          'plugin-a.entity.author': {
            provider: { scope: 'project', skill: 'override-skill' },
          },
        },
      },
    });
    expect(result.ok).toBe(true);
    const entry = result.index!.entries.find(e => e.ref === 'plugin-a.entity.author')!;
    expect(entry.provider).toEqual({ scope: 'project', skill: 'override-skill' });
    expect(entry.provenance.overriddenBy).toBe('agent-methods.yaml');
    expect(entry.provenance.sourceCatalog).toBe('plugin-a');
  });
});

// ── Disabled tombstone/provenance ──────────────────────────────

describe('buildEffectiveIndex — disabled tombstone/provenance', () => {
  it('disabled entry is removed from entries and appears in disabledEntries', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        disabled: ['plugin-a.entity.validate'],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.index!.entries.some(e => e.ref === 'plugin-a.entity.validate')).toBe(false);
    const tombstone = result.index!.disabledEntries.find(
      e => e.ref === 'plugin-a.entity.validate'
    );
    expect(tombstone).toBeDefined();
    expect(tombstone!.sourceCatalog).toBe('plugin-a');
    expect(tombstone!.disabledBy).toBe('agent-methods.yaml');
    expect(tombstone!.provider).toEqual({
      scope: 'plugin',
      plugin: 'plugin-a',
      skill: 'validate-skill',
    });
  });

  it('disabled project entry has sourceCatalog "project"', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        entries: [
          {
            ref: 'project.entry.one',
            provider: { scope: 'project', skill: 'proj-skill' },
            kind: 'workflow',
            summary: 'Project entry',
            match: { domains: ['d'], artifactTypes: ['a'], intents: ['i'] },
            accepts: ['x'],
            produces: ['y'],
            sideEffects: ['write-project-artifacts'],
          },
        ],
        disabled: ['project.entry.one'],
      },
    });
    expect(result.ok).toBe(true);
    const tombstone = result.index!.disabledEntries.find(e => e.ref === 'project.entry.one');
    expect(tombstone).toBeDefined();
    expect(tombstone!.sourceCatalog).toBe('project');
    expect(tombstone!.disabledBy).toBe('agent-methods.yaml');
  });

  it('rejects disabled targeting non-existent ref', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: {
        schemaVersion: 1,
        disabled: ['nonexistent.ref'],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'UNKNOWN_DISABLED_REF')).toBe(true);
  });
});

// ── Sorting and inputs ─────────────────────────────────────────

describe('buildEffectiveIndex — sorting and inputs', () => {
  it('entries are sorted by ref', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A, VALID_CATALOG_B] });
    expect(result.ok).toBe(true);
    const refs = result.index!.entries.map(e => e.ref);
    const sorted = [...refs].sort();
    expect(refs).toEqual(sorted);
  });

  it('disabledEntries are sorted by ref', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A, VALID_CATALOG_B],
      project: {
        schemaVersion: 1,
        disabled: ['plugin-b.entity.deploy', 'plugin-a.entity.author'],
      },
    });
    expect(result.ok).toBe(true);
    const refs = result.index!.disabledEntries.map(e => e.ref);
    const sorted = [...refs].sort();
    expect(refs).toEqual(sorted);
  });

  it('inputs.catalogs contains id, version, contentHash per catalog', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A, VALID_CATALOG_B] });
    expect(result.ok).toBe(true);
    expect(result.index!.inputs.catalogs).toHaveLength(2);
    for (const c of result.index!.inputs.catalogs) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('version');
      expect(c).toMatchObject({
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      });
    }
  });

  it('inputs.projectContentHash is set when project overlay is provided', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: { schemaVersion: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.index!.inputs.projectContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('inputs.projectContentHash is a hash even when no project overlay', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A] });
    expect(result.ok).toBe(true);
    expect(result.index!.inputs.projectContentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('schemaVersion is always 1', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A] });
    expect(result.ok).toBe(true);
    expect(result.index!.schemaVersion).toBe(1);
  });

  it('no timestamps in output', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A] });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.index);
    expect(serialized).not.toMatch(/timestamp/i);
    expect(serialized).not.toMatch(/"date"/);
    expect(serialized).not.toMatch(/"duration"/);
  });

  it('no verification fields in output', () => {
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A] });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.index);
    expect(serialized).not.toMatch(/providerVerified/);
    expect(serialized).not.toMatch(/"verification"/);
  });

  it('effective index has correct structure', () => {
    const result = buildEffectiveIndex({
      catalogs: [VALID_CATALOG_A],
      project: { schemaVersion: 1 },
    });
    expect(result.ok).toBe(true);
    const idx = result.index!;
    expect(idx).toHaveProperty('schemaVersion', 1);
    expect(idx).toHaveProperty('inputs');
    expect(idx.inputs).toHaveProperty('catalogs');
    expect(idx.inputs).toHaveProperty('projectContentHash');
    expect(idx).toHaveProperty('entries');
    expect(idx).toHaveProperty('disabledEntries');
  });
});

// ── Effective index validation ─────────────────────────────────

describe('validateEffectiveIndex', () => {
  it('validates a correct effective index', async () => {
    const { validateEffectiveIndex } = await import('../src/schema/effective.js');
    const result = buildEffectiveIndex({ catalogs: [VALID_CATALOG_A] });
    expect(result.ok).toBe(true);
    const vResult = validateEffectiveIndex(result.index);
    expect(vResult.ok).toBe(true);
    expect(vResult.diagnostics).toHaveLength(0);
  });

  it('rejects invalid effective index', async () => {
    const { validateEffectiveIndex } = await import('../src/schema/effective.js');
    const vResult = validateEffectiveIndex({ bad: true });
    expect(vResult.ok).toBe(false);
    expect(vResult.diagnostics.length).toBeGreaterThan(0);
    expect(vResult.diagnostics[0].code).toBe('INVALID_EFFECTIVE_INDEX');
  });
});
