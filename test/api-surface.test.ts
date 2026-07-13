/**
 * API surface test — enforces the maintainer-defined public export list.
 *
 * Design authority: §7.1 / §11.2 of the design document.
 * Maintainer decision: exactly 7 public functions + ERROR_CODES + domain types.
 *
 * TDD: this test was written BEFORE the src/index.ts change.
 * When first run against the current 12-export baseline it must FAIL (RED).
 * After src/index.ts is trimmed to the canonical 7, it will PASS (GREEN).
 */
import { describe, it, expect, beforeAll } from 'vitest';

// The 7 canonical public functions per design §7.1/§11.2 + maintainer decision.
const EXPECTED_FUNCTIONS = [
  'validateCatalog',
  'validateProjectOverlay',
  'buildEffectiveIndex',
  'queryEffectiveIndex',
  'resolveEntry',
  'verifyProvider',
  'diagnoseRegistry',
] as const;

// Non-function runtime exports that must also be present.
const EXPECTED_CONSTANTS = [
  'ERROR_CODES',
] as const;

// Runtime exports that must NOT be present in the public API.
// (removed from package root; still available as internal implementation)
const FORBIDDEN_RUNTIME = [
  'SOURCE_LABELS',
  'isValidSourceLabel',
  'validateAgainstSchema',
  'canonicalizeJson',
  'canonicalStringify',
  'computeContentHash',
  'validateEffectiveIndex',
] as const;

describe('api-surface — public runtime exports', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: Record<string, any>;

  beforeAll(async () => {
    mod = await import('../src/index.js');
  });

  it(`exports exactly ${EXPECTED_FUNCTIONS.length} functions`, () => {
    const actualFunctions = Object.keys(mod)
      .filter(k => typeof mod[k] === 'function')
      .sort();
    expect(actualFunctions).toEqual([...EXPECTED_FUNCTIONS].sort());
  });

  it('exports ERROR_CODES constant', () => {
    expect(mod.ERROR_CODES).toBeDefined();
    expect(Array.isArray(mod.ERROR_CODES)).toBe(true);
  });

  it.each(EXPECTED_FUNCTIONS)('exports function %s', (name) => {
    expect(typeof mod[name]).toBe('function');
  });

  it.each(EXPECTED_CONSTANTS)('exports constant %s', (name) => {
    expect(mod[name]).toBeDefined();
  });

  it.each(FORBIDDEN_RUNTIME)('does NOT export removed symbol %s', (name) => {
    expect(mod[name]).toBeUndefined();
  });
});

describe('api-surface — diagnoseRegistry types are exported', () => {
  // Type-only exports can't be checked at runtime, but we can verify
  // the function signature accepts the right shape.
  it('diagnoseRegistry accepts DiagnoseInput shape', async () => {
    const { diagnoseRegistry } = await import('../src/index.js');
    // Minimal valid call — must not throw
    const result = diagnoseRegistry({ catalogs: [] });
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('diagnostics');
  });
});
