import { describe, it, expect } from 'vitest';
import { buildEffectiveIndex } from '../src/resolver/index.js';
import type { EffectiveIndex, EffectiveEntry } from '../src/resolver/index.js';
import { queryEffectiveIndex } from '../src/query/engine.js';
import type { CompactEntry, QueryInput, QueryResult } from '../src/query/engine.js';

// ── Shared test fixtures ────────────────────────────────────────

const CATALOG_MULTI_DOMAIN = {
  schemaVersion: 1,
  catalog: { id: 'multi-domain', version: '1.0.0' },
  entries: [
    {
      ref: 'multi-domain.entity.author',
      provider: { scope: 'plugin' as const, plugin: 'multi-domain', skill: 'author-skill' },
      kind: 'workflow' as const,
      summary: 'Author entity workflow',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['author'] },
      accepts: ['objective'],
      produces: ['artifact'],
      sideEffects: ['write-project-artifacts'],
    },
    {
      ref: 'multi-domain.entity.validate',
      provider: { scope: 'plugin' as const, plugin: 'multi-domain', skill: 'validate-skill' },
      kind: 'operation' as const,
      summary: 'Validate entity operation',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['validate'] },
      accepts: ['artifact'],
      produces: ['validation-result'],
      sideEffects: ['read-only'],
    },
    {
      ref: 'multi-domain.manifest.deploy',
      provider: { scope: 'plugin' as const, plugin: 'multi-domain', skill: 'deploy-skill' },
      kind: 'workflow' as const,
      summary: 'Deploy manifest workflow',
      match: { domains: ['deploy'], artifactTypes: ['manifest'], intents: ['deploy'] },
      accepts: ['manifest'],
      produces: ['deployment'],
      sideEffects: ['external-state-change'],
    },
    {
      ref: 'multi-domain.manifest.review',
      provider: { scope: 'plugin' as const, plugin: 'multi-domain', skill: 'review-skill' },
      kind: 'operation' as const,
      summary: 'Review manifest operation',
      match: { domains: ['deploy'], artifactTypes: ['manifest'], intents: ['review'] },
      accepts: ['manifest'],
      produces: ['review-result'],
      sideEffects: ['read-only'],
    },
  ],
};

const CATALOG_SECOND = {
  schemaVersion: 1,
  catalog: { id: 'second-cat', version: '0.2.0' },
  entries: [
    {
      ref: 'second-cat.entity.test',
      provider: { scope: 'plugin' as const, plugin: 'second-cat', skill: 'test-skill' },
      kind: 'operation' as const,
      summary: 'Test entity operation',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['test'] },
      accepts: ['artifact'],
      produces: ['test-result'],
      sideEffects: ['read-only'],
    },
    {
      ref: 'second-cat.doc.generate',
      provider: { scope: 'plugin' as const, plugin: 'second-cat', skill: 'doc-skill' },
      kind: 'workflow' as const,
      summary: 'Generate doc workflow',
      match: { domains: ['docs'], artifactTypes: ['doc'], intents: ['generate'] },
      accepts: ['spec'],
      produces: ['doc'],
      sideEffects: ['write-project-artifacts'],
    },
  ],
};

// Build a catalog with many entries for limit testing
function buildLargeCatalog(count: number) {
  const entries = Array.from({ length: count }, (_, i) => ({
    ref: `large-cat.entry.${String(i).padStart(3, '0')}`,
    provider: { scope: 'plugin' as const, plugin: 'large-cat', skill: `skill-${i}` },
    kind: (i % 2 === 0 ? 'workflow' : 'operation') as 'workflow' | 'operation',
    summary: `Entry number ${i} summary`,
    match: { domains: ['test'], artifactTypes: ['thing'], intents: ['do'] },
    accepts: ['input'],
    produces: ['output'],
    sideEffects: ['read-only'],
  }));
  return {
    schemaVersion: 1,
    catalog: { id: 'large-cat', version: '1.0.0' },
    entries,
  };
}

// Helper: build a valid index for test use
function buildTestIndex(catalogs: unknown[] = [CATALOG_MULTI_DOMAIN], project?: unknown): EffectiveIndex {
  const result = buildEffectiveIndex({ catalogs, project });
  if (!result.ok) {
    throw new Error(`Failed to build test index: ${result.diagnostics.map(d => d.message).join(', ')}`);
  }
  return result.index!;
}

// ── Filters by domain ───────────────────────────────────────────

describe('queryEffectiveIndex — filter by domain', () => {
  it('returns only entries matching the given domain', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index, domain: 'artifact' });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(2);
    for (const entry of result.data!.entries as CompactEntry[]) {
      // compact mode: check ref
      expect(entry.ref).toContain('entity');
    }
  });

  it('returns empty array with NO_QUERY_MATCH when domain does not match', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index, domain: 'nonexistent-domain' });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('NO_QUERY_MATCH');
    expect(result.diagnostics[0].severity).toBe('info');
  });
});

// ── Filters by artifactType + intent ────────────────────────────

describe('queryEffectiveIndex — filter by artifactType + intent', () => {
  it('returns only entries matching both artifactType and intent', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index, artifactType: 'manifest', intent: 'deploy' });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(1);
    expect((result.data!.entries[0] as CompactEntry).ref).toBe('multi-domain.manifest.deploy');
  });

  it('returns empty when artifactType matches but intent does not', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index, artifactType: 'entity', intent: 'deploy' });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(0);
    expect(result.diagnostics.some(d => d.code === 'NO_QUERY_MATCH')).toBe(true);
  });
});

// ── Filter by kind ──────────────────────────────────────────────

describe('queryEffectiveIndex — filter by kind', () => {
  it('returns only workflow entries when kind=workflow', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index, kind: 'workflow' });
    expect(result.ok).toBe(true);
    for (const entry of result.data!.entries as CompactEntry[]) {
      expect(entry.kind).toBe('workflow');
    }
    expect(result.data!.entries).toHaveLength(2);
  });

  it('returns only operation entries when kind=operation', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index, kind: 'operation' });
    expect(result.ok).toBe(true);
    for (const entry of result.data!.entries as CompactEntry[]) {
      expect(entry.kind).toBe('operation');
    }
    expect(result.data!.entries).toHaveLength(2);
  });
});

// ── Combined filters ────────────────────────────────────────────

describe('queryEffectiveIndex — combined filters', () => {
  it('applies AND logic: domain + kind + artifactType', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({
      index,
      domain: 'artifact',
      kind: 'workflow',
      artifactType: 'entity',
    });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(1);
    expect((result.data!.entries[0] as CompactEntry).ref).toBe('multi-domain.entity.author');
  });
});

// ── Default limit ───────────────────────────────────────────────

describe('queryEffectiveIndex — default limit', () => {
  it('returns at most 8 entries by default', () => {
    const largeCatalog = buildLargeCatalog(15);
    const index = buildTestIndex([largeCatalog]);
    const result = queryEffectiveIndex({ index });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(8);
  });

  it('returns all entries when there are fewer than 8', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(4);
  });
});

// ── Custom limit ────────────────────────────────────────────────

describe('queryEffectiveIndex — custom limit', () => {
  it('returns at most 3 entries when limit=3', () => {
    const largeCatalog = buildLargeCatalog(15);
    const index = buildTestIndex([largeCatalog]);
    const result = queryEffectiveIndex({ index, limit: 3 });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(3);
  });
});

// ── Invalid input ───────────────────────────────────────────────

describe('queryEffectiveIndex — invalid input', () => {
  it('rejects non-positive limit', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, limit: 0 });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('INVALID_QUERY');
    expect(result.diagnostics[0].severity).toBe('error');
  });

  it('rejects negative limit', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, limit: -1 });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('INVALID_QUERY');
  });

  it('rejects non-integer limit', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, limit: 2.5 });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('INVALID_QUERY');
  });

  it('rejects invalid format', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, format: 'invalid' as any });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0].code).toBe('INVALID_QUERY');
  });

  it('rejects invalid index (not matching EffectiveIndex schema)', () => {
    const result = queryEffectiveIndex({ index: { bad: true } as any });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_EFFECTIVE_INDEX')).toBe(true);
  });
});

// ── Compact mode ────────────────────────────────────────────────

describe('queryEffectiveIndex — compact mode', () => {
  it('returns only ref, kind, summary in compact mode', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, format: 'compact' });
    expect(result.ok).toBe(true);
    for (const entry of result.data!.entries as CompactEntry[]) {
      const keys = Object.keys(entry).sort();
      expect(keys).toEqual(['kind', 'ref', 'summary']);
    }
  });

  it('compact entries have ref <= 128 code points', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, format: 'compact' });
    expect(result.ok).toBe(true);
    for (const entry of result.data!.entries as CompactEntry[]) {
      expect([...entry.ref].length).toBeLessThanOrEqual(128);
    }
  });

  it('compact entries have summary <= 160 code points', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, format: 'compact' });
    expect(result.ok).toBe(true);
    for (const entry of result.data!.entries as CompactEntry[]) {
      expect([...entry.summary].length).toBeLessThanOrEqual(160);
    }
  });

  it('compact mode serialization is <= 400 code points per entry', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, format: 'compact' });
    expect(result.ok).toBe(true);
    for (const entry of result.data!.entries as CompactEntry[]) {
      const serialized = JSON.stringify(entry);
      expect([...serialized].length).toBeLessThanOrEqual(400);
    }
  });
});

// ── Full mode ───────────────────────────────────────────────────

describe('queryEffectiveIndex — full mode', () => {
  it('returns complete EffectiveEntry in full mode', () => {
    const index = buildTestIndex();
    const result = queryEffectiveIndex({ index, format: 'full' });
    expect(result.ok).toBe(true);
    for (const entry of result.data!.entries as EffectiveEntry[]) {
      expect(entry).toHaveProperty('ref');
      expect(entry).toHaveProperty('provider');
      expect(entry).toHaveProperty('kind');
      expect(entry).toHaveProperty('summary');
      expect(entry).toHaveProperty('match');
      expect(entry).toHaveProperty('accepts');
      expect(entry).toHaveProperty('produces');
      expect(entry).toHaveProperty('sideEffects');
      expect(entry).toHaveProperty('provenance');
    }
  });
});

// ── Shadowed/overridden provider ────────────────────────────────

describe('queryEffectiveIndex — shadowed provider', () => {
  it('shadowed (overridden) provider appears with overridden provenance, not as duplicate', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN], {
      schemaVersion: 1,
      overrides: {
        'multi-domain.entity.author': {
          provider: { scope: 'project', skill: 'override-author' },
        },
      },
    });
    const result = queryEffectiveIndex({ index, format: 'full' });
    expect(result.ok).toBe(true);
    // Only one entry with ref 'multi-domain.entity.author' should appear
    const authorEntries = (result.data!.entries as EffectiveEntry[]).filter(
      e => e.ref === 'multi-domain.entity.author'
    );
    expect(authorEntries).toHaveLength(1);
    expect(authorEntries[0].provenance.overriddenBy).toBe('agent-methods.yaml');
    expect(authorEntries[0].provider).toEqual({ scope: 'project', skill: 'override-author' });
  });

  it('disabled entry does NOT appear in query results', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN], {
      schemaVersion: 1,
      disabled: ['multi-domain.entity.validate'],
    });
    const result = queryEffectiveIndex({ index });
    expect(result.ok).toBe(true);
    const refs = (result.data!.entries as CompactEntry[]).map(e => e.ref);
    expect(refs).not.toContain('multi-domain.entity.validate');
  });
});

// ── No match ────────────────────────────────────────────────────

describe('queryEffectiveIndex — no match', () => {
  it('returns ok:true with empty array and NO_QUERY_MATCH info diagnostic', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index, intent: 'nonexistent-intent' });
    expect(result.ok).toBe(true);
    expect(result.data!.entries).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: 'NO_QUERY_MATCH',
        severity: 'info',
      })
    );
  });
});

// ── No filesystem side effects ──────────────────────────────────

describe('queryEffectiveIndex — no filesystem side effects', () => {
  it('works purely with in-memory index (no SKILL.md read)', () => {
    // Build index from inline data, not from files
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN]);
    const result = queryEffectiveIndex({ index });
    expect(result.ok).toBe(true);
    // If it tried to read files, it would have thrown or errored
    expect(result.data!.entries.length).toBeGreaterThan(0);
  });
});

// ── Multiple catalogs ───────────────────────────────────────────

describe('queryEffectiveIndex — multiple catalogs', () => {
  it('queries across entries from multiple catalogs', () => {
    const index = buildTestIndex([CATALOG_MULTI_DOMAIN, CATALOG_SECOND]);
    const result = queryEffectiveIndex({ index, domain: 'artifact' });
    expect(result.ok).toBe(true);
    // multi-domain: entity.author + entity.validate (2), second-cat: entity.test (1) = 3
    expect(result.data!.entries).toHaveLength(3);
  });
});
