import { describe, it, expect } from 'vitest';
import { canonicalStringify, canonicalizeJson } from '../src/canonicalize/entry.js';
import { computeContentHash } from '../src/canonicalize/content-hash.js';

// ─── canonicalStringify: key sorting ────────────────────────────────

describe('canonicalStringify — key sorting', () => {
  it('sorts object keys in Unicode code point order', () => {
    expect(canonicalStringify({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts keys case-sensitively (A=65 < B=66 < a=97)', () => {
    expect(canonicalStringify({ B: 1, a: 2, A: 3 })).toBe('{"A":3,"B":1,"a":2}');
  });

  it('sorts nested object keys', () => {
    const input = { z: { c: 1, a: 2 }, a: 1 };
    expect(canonicalStringify(input)).toBe('{"a":1,"z":{"a":2,"c":1}}');
  });

  it('produces no whitespace', () => {
    expect(canonicalStringify({ a: 1, b: [1, 2, 3] })).toBe('{"a":1,"b":[1,2,3]}');
  });
});

// ─── canonicalStringify: array sorting ──────────────────────────────

describe('canonicalStringify — array sorting', () => {
  it('sorts string arrays alphabetically', () => {
    expect(canonicalStringify(['z', 'a', 'm'])).toBe('["a","m","z"]');
  });

  it('sorts entry-like objects by ref', () => {
    const entries = [
      { ref: 'b/method', provider: { name: 'bp' } },
      { ref: 'a/method', provider: { name: 'ap' } },
    ];
    const result = canonicalStringify(entries);
    expect(result).toBe(
      '[{"provider":{"name":"ap"},"ref":"a/method"},{"provider":{"name":"bp"},"ref":"b/method"}]'
    );
  });

  it('sorts catalog-like objects by id', () => {
    const catalogs = [
      { id: 'beta', version: '1.0.0' },
      { id: 'alpha', version: '1.0.0' },
    ];
    const result = canonicalStringify(catalogs);
    expect(result).toBe(
      '[{"id":"alpha","version":"1.0.0"},{"id":"beta","version":"1.0.0"}]'
    );
  });

  it('sorts full catalog structure deterministically', () => {
    const catalog = {
      schemaVersion: '1.0.0',
      catalog: { id: 'test', version: '1.0.0' },
      entries: [
        {
          ref: 'b/method',
          summary: 'B',
          match: { domains: ['web', 'api'], intents: ['build', 'deploy'] },
          provider: { name: 'bp' },
        },
        {
          ref: 'a/method',
          summary: 'A',
          match: { domains: ['api', 'web'], intents: ['deploy', 'build'] },
          provider: { name: 'ap' },
        },
      ],
    };
    const result = canonicalStringify(catalog);
    // Parse back to verify structure
    const parsed = JSON.parse(result);
    // entries sorted by ref
    expect(parsed.entries[0].ref).toBe('a/method');
    expect(parsed.entries[1].ref).toBe('b/method');
    // domains sorted
    expect(parsed.entries[0].match.domains).toEqual(['api', 'web']);
    // intents sorted
    expect(parsed.entries[0].match.intents).toEqual(['build', 'deploy']);
  });
});

// ─── canonicalizeJson ───────────────────────────────────────────────

describe('canonicalizeJson', () => {
  it('returns primitives unchanged', () => {
    expect(canonicalizeJson(42)).toBe(42);
    expect(canonicalizeJson('hello')).toBe('hello');
    expect(canonicalizeJson(true)).toBe(true);
    expect(canonicalizeJson(null)).toBe(null);
  });

  it('sorts object keys recursively', () => {
    const input = { z: { c: 1 }, a: 1 };
    const result = canonicalizeJson(input) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['a', 'z']);
    expect(Object.keys(result['z'] as Record<string, unknown>)).toEqual(['c']);
  });

  it('sorts arrays of strings', () => {
    expect(canonicalizeJson(['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('sorts arrays of objects by stringified form', () => {
    const input = [{ b: 1 }, { a: 1 }];
    const result = canonicalizeJson(input) as unknown[];
    expect(JSON.stringify(result)).toBe('[{"a":1},{"b":1}]');
  });
});

// ─── computeContentHash ─────────────────────────────────────────────

describe('computeContentHash', () => {
  it('produces sha256:<64-hex-lowercase> format', () => {
    const hash = computeContentHash({ hello: 'world' });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is deterministic for same input', () => {
    const data = { a: 1, b: 2 };
    expect(computeContentHash(data)).toBe(computeContentHash(data));
  });

  it('catalog entries in shuffled order produce same contentHash', () => {
    const catalogA = {
      schemaVersion: '1.0.0',
      catalog: { id: 'test', version: '1.0.0' },
      entries: [
        { ref: 'a/method', summary: 'A', provider: { name: 'ap' } },
        { ref: 'b/method', summary: 'B', provider: { name: 'bp' } },
      ],
    };
    const catalogB = {
      schemaVersion: '1.0.0',
      catalog: { id: 'test', version: '1.0.0' },
      entries: [
        { ref: 'b/method', summary: 'B', provider: { name: 'bp' } },
        { ref: 'a/method', summary: 'A', provider: { name: 'ap' } },
      ],
    };
    expect(computeContentHash(catalogA)).toBe(computeContentHash(catalogB));
  });

  it('match arrays in shuffled order produce same contentHash', () => {
    const entryA = {
      ref: 'test/method',
      match: { domains: ['web', 'api'], intents: ['build', 'deploy'] },
      provider: { name: 'p' },
    };
    const entryB = {
      ref: 'test/method',
      match: { domains: ['api', 'web'], intents: ['deploy', 'build'] },
      provider: { name: 'p' },
    };
    expect(computeContentHash(entryA)).toBe(computeContentHash(entryB));
  });

  it('accepts/produces/sideEffects in shuffled order produce same contentHash', () => {
    const entryA = {
      ref: 'test/method',
      accepts: ['text/plain', 'application/json'],
      produces: ['html', 'markdown'],
      sideEffects: ['network', 'filesystem'],
      provider: { name: 'p' },
    };
    const entryB = {
      ref: 'test/method',
      accepts: ['application/json', 'text/plain'],
      produces: ['markdown', 'html'],
      sideEffects: ['filesystem', 'network'],
      provider: { name: 'p' },
    };
    expect(computeContentHash(entryA)).toBe(computeContentHash(entryB));
  });

  it('changing catalog.version changes contentHash', () => {
    const a = {
      schemaVersion: '1.0.0',
      catalog: { id: 'test', version: '1.0.0' },
      entries: [{ ref: 'a/m', provider: { name: 'p' } }],
    };
    const b = {
      schemaVersion: '1.0.0',
      catalog: { id: 'test', version: '2.0.0' },
      entries: [{ ref: 'a/m', provider: { name: 'p' } }],
    };
    expect(computeContentHash(a)).not.toBe(computeContentHash(b));
  });

  it('changing schemaVersion changes contentHash', () => {
    const a = { schemaVersion: '1.0.0', catalog: { id: 'x', version: '1' }, entries: [] };
    const b = { schemaVersion: '2.0.0', catalog: { id: 'x', version: '1' }, entries: [] };
    expect(computeContentHash(a)).not.toBe(computeContentHash(b));
  });

  it('changing entry summary changes catalog contentHash', () => {
    const a = {
      schemaVersion: '1.0.0',
      catalog: { id: 'test', version: '1.0.0' },
      entries: [{ ref: 'a/m', summary: 'old', provider: { name: 'p' } }],
    };
    const b = {
      schemaVersion: '1.0.0',
      catalog: { id: 'test', version: '1.0.0' },
      entries: [{ ref: 'a/m', summary: 'new', provider: { name: 'p' } }],
    };
    expect(computeContentHash(a)).not.toBe(computeContentHash(b));
  });

  it('changing project overlay overrides order does NOT change contentHash', () => {
    const a = {
      schemaVersion: '1.0.0',
      entries: [],
      overrides: [
        { ref: 'a/m', provider: { name: 'x' } },
        { ref: 'b/m', provider: { name: 'y' } },
      ],
      disabled: [],
    };
    const b = {
      schemaVersion: '1.0.0',
      entries: [],
      overrides: [
        { ref: 'b/m', provider: { name: 'y' } },
        { ref: 'a/m', provider: { name: 'x' } },
      ],
      disabled: [],
    };
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });

  it('object key case change changes contentHash', () => {
    const a = { Name: 'test', name: 'other' };
    const b = { name: 'other', Name: 'test' };
    // Same keys, just different order — canonical should produce same hash
    expect(computeContentHash(a)).toBe(computeContentHash(b));
    // But changing key case itself:
    const c = { name: 'test', Name: 'other' };
    const d = { name: 'test', name2: 'other' };
    expect(computeContentHash(c)).not.toBe(computeContentHash(d));
  });
});
