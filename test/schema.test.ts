import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, '../schemas');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

function loadJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadYaml(fixtureRelPath: string) {
  return parseYaml(readFileSync(resolve(FIXTURES_DIR, fixtureRelPath), 'utf-8'));
}

function createAjv() {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv;
}

function compileSchema(schemaName: string) {
  const ajv = createAjv();
  const schema = loadJson(resolve(SCHEMAS_DIR, `${schemaName}.schema.json`));
  return ajv.compile(schema);
}

// ── Schema compilation ──────────────────────────────────────────

describe('JSON Schema compilation', () => {
  const schemaNames = ['catalog', 'project', 'effective-index', 'diagnostic-envelope'] as const;

  for (const name of schemaNames) {
    it(`${name}.schema.json compiles as valid JSON Schema`, () => {
      const schema = loadJson(resolve(SCHEMAS_DIR, `${name}.schema.json`));
      const ajv = createAjv();
      expect(() => ajv.compile(schema)).not.toThrow();
    });
  }
});

// ── Catalog schema validation ───────────────────────────────────

describe('catalog schema validation', () => {
  it('valid plugin catalog passes validation', () => {
    const v = compileSchema('catalog');
    const catalog = loadJson(resolve(FIXTURES_DIR, 'catalogs', 'valid-plugin.json'));
    expect(v(catalog)).toBe(true);
  });

  it('catalog with additionalProperties is rejected', () => {
    const v = compileSchema('catalog');
    const bad = {
      schemaVersion: 1,
      catalog: { id: 'test-plugin', version: '1.0.0' },
      entries: [],
      unknownField: true,
    };
    expect(v(bad)).toBe(false);
  });

  it('catalog entry with project provider is rejected', () => {
    const v = compileSchema('catalog');
    const bad = {
      schemaVersion: 1,
      catalog: { id: 'test-plugin', version: '1.0.0' },
      entries: [
        {
          ref: 'test.entry.action',
          provider: { scope: 'project', skill: 'my-skill' },
          kind: 'workflow',
          summary: 'Test entry',
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only'],
        },
      ],
    };
    expect(v(bad)).toBe(false);
  });

  it('catalog with schemaVersion 2 is rejected', () => {
    const v = compileSchema('catalog');
    const bad = {
      schemaVersion: 2,
      catalog: { id: 'test-plugin', version: '1.0.0' },
      entries: [],
    };
    expect(v(bad)).toBe(false);
  });
});

// ── Project schema validation ───────────────────────────────────

describe('project schema validation', () => {
  it('valid project overlay passes validation', () => {
    const v = compileSchema('project');
    const overlay = loadJson(resolve(FIXTURES_DIR, 'projects', 'valid-overlay.json'));
    expect(v(overlay)).toBe(true);
  });
});

// ── Error codes ─────────────────────────────────────────────────

describe('ErrorCode enum', () => {
  it('covers all 24 error codes', async () => {
    const { ERROR_CODES } = await import('../src/errors/codes.js');
    expect(ERROR_CODES).toHaveLength(24);
  });

  it('has expected codes', async () => {
    const { ERROR_CODES } = await import('../src/errors/codes.js');
    expect(ERROR_CODES).toContain('SCHEMA_VERSION_UNSUPPORTED');
    expect(ERROR_CODES).toContain('INVALID_CATALOG');
    expect(ERROR_CODES).toContain('INVALID_PROJECT_OVERLAY');
    expect(ERROR_CODES).toContain('DUPLICATE_CATALOG_ID');
    expect(ERROR_CODES).toContain('ENTRY_NOT_FOUND');
    expect(ERROR_CODES).toContain('CLI_USAGE_ERROR');
    expect(ERROR_CODES).toContain('STALE_EFFECTIVE_INDEX');
  });
});

// ── validateAgainstSchema ───────────────────────────────────────

describe('validateAgainstSchema', () => {
  it('returns diagnostics with source.label on failure', async () => {
    const { validateAgainstSchema } = await import('../src/validate/input.js');
    const result = validateAgainstSchema('catalog', { bad: true }, 'INVALID_CATALOG');
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe('INVALID_CATALOG');
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].source).toBeDefined();
    expect(result.diagnostics[0].source!.label).toBeDefined();
  });

  it('uses caller-provided failureCode', async () => {
    const { validateAgainstSchema } = await import('../src/validate/input.js');
    const result = validateAgainstSchema('catalog', { bad: true }, 'SCHEMA_VERSION_UNSUPPORTED');
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0].code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('returns valid true for correct data', async () => {
    const { validateAgainstSchema } = await import('../src/validate/input.js');
    const catalog = loadJson(resolve(FIXTURES_DIR, 'catalogs', 'valid-plugin.json'));
    const result = validateAgainstSchema('catalog', catalog, 'INVALID_CATALOG');
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ── Diagnostic type ─────────────────────────────────────────────

describe('Diagnostic and source labels', () => {
  it('isValidSourceLabel validates correctly', async () => {
    const { isValidSourceLabel } = await import('../src/errors/codes.js');
    expect(isValidSourceLabel('<project>')).toBe(true);
    expect(isValidSourceLabel('<index>')).toBe(true);
    expect(isValidSourceLabel('<external>')).toBe(true);
    expect(isValidSourceLabel('<catalog:my-plugin>')).toBe(true);
    expect(isValidSourceLabel('/absolute/path')).toBe(false);
    expect(isValidSourceLabel('relative/path')).toBe(false);
  });
});

// ── validateCatalog (semantic validation) ──────────────────────

describe('validateCatalog', () => {
  it('valid plugin catalog passes validation and returns data', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = loadJson(resolve(FIXTURES_DIR, 'catalogs', 'valid-plugin.json'));
    const result = validateCatalog(data);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.catalog.id).toBe('artifact-chain-assistant');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('catalog missing id returns INVALID_CATALOG (schema level)', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = loadYaml('catalogs/invalid-missing-id.yaml');
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe('INVALID_CATALOG');
  });

  it('catalog with schemaVersion 2 returns SCHEMA_VERSION_UNSUPPORTED', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = loadYaml('catalogs/invalid-schema-version.yaml');
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe('SCHEMA_VERSION_UNSUPPORTED');
    expect(result.diagnostics[0].severity).toBe('error');
  });

  it('catalog entry with project variant provider returns INVALID_CATALOG', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = loadYaml('catalogs/invalid-project-variant-provider.yaml');
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    // This fails at schema level since catalog schema only allows pluginProvider
    expect(result.diagnostics[0].code).toBe('INVALID_CATALOG');
  });

  it('catalog entry provider.plugin != catalog.id returns INVALID_CATALOG', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = loadYaml('catalogs/invalid-plugin-mismatch.yaml');
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some(d => d.code === 'INVALID_CATALOG')).toBe(true);
    expect(result.diagnostics.some(d => d.message.includes('plugin'))).toBe(true);
  });

  it('sideEffects with read-only and write-project-artifacts returns INVALID_CATALOG', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = loadYaml('catalogs/invalid-sideeffects-conflict.yaml');
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some(d => d.code === 'INVALID_CATALOG')).toBe(true);
    expect(result.diagnostics.some(d => d.message.toLowerCase().includes('sideeffect') || d.message.includes('read-only'))).toBe(true);
  });

  it('duplicate refs in entries returns INVALID_CATALOG', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = {
      schemaVersion: 1,
      catalog: { id: 'test-plugin', version: '1.0.0' },
      entries: [
        {
          ref: 'duplicate.ref',
          provider: { scope: 'plugin', plugin: 'test-plugin', skill: 'skill-a' },
          kind: 'workflow' as const,
          summary: 'Entry A',
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only'],
        },
        {
          ref: 'duplicate.ref',
          provider: { scope: 'plugin', plugin: 'test-plugin', skill: 'skill-b' },
          kind: 'operation' as const,
          summary: 'Entry B',
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only'],
        },
      ],
    };
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_CATALOG')).toBe(true);
    expect(result.diagnostics.some(d => d.message.includes('ref'))).toBe(true);
  });

  it('summary exceeding 160 code points returns INVALID_CATALOG', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const longSummary = 'A'.repeat(161);
    const data = {
      schemaVersion: 1,
      catalog: { id: 'test-plugin', version: '1.0.0' },
      entries: [
        {
          ref: 'test.entry',
          provider: { scope: 'plugin', plugin: 'test-plugin', skill: 'test-skill' },
          kind: 'workflow' as const,
          summary: longSummary,
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only'],
        },
      ],
    };
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_CATALOG')).toBe(true);
  });

  it('compact projection exceeding 400 code points returns INVALID_CATALOG', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    // Create an entry with long ref + kind + summary that exceeds 400 code points
    const longSummary = 'B'.repeat(300);
    const data = {
      schemaVersion: 1,
      catalog: { id: 'test-plugin', version: '1.0.0' },
      entries: [
        {
          ref: 'a'.repeat(80),
          provider: { scope: 'plugin', plugin: 'test-plugin', skill: 'test-skill' },
          kind: 'workflow' as const,
          summary: longSummary,
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only'],
        },
      ],
    };
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_CATALOG')).toBe(true);
  });

  it('sideEffects with read-only and external-state-change returns INVALID_CATALOG', async () => {
    const { validateCatalog } = await import('../src/schema/catalog.js');
    const data = {
      schemaVersion: 1,
      catalog: { id: 'test-plugin', version: '1.0.0' },
      entries: [
        {
          ref: 'test.entry',
          provider: { scope: 'plugin', plugin: 'test-plugin', skill: 'test-skill' },
          kind: 'workflow' as const,
          summary: 'Test entry',
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only', 'external-state-change'],
        },
      ],
    };
    const result = validateCatalog(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_CATALOG')).toBe(true);
  });
});

// ── validateProjectOverlay (semantic validation) ──────────────

describe('validateProjectOverlay', () => {
  it('valid project overlay passes validation and returns data', async () => {
    const { validateProjectOverlay } = await import('../src/schema/project.js');
    const data = loadJson(resolve(FIXTURES_DIR, 'projects', 'valid-overlay.json'));
    const result = validateProjectOverlay(data);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.schemaVersion).toBe(1);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('project overlay with unknown field returns INVALID_PROJECT_OVERLAY (schema level)', async () => {
    const { validateProjectOverlay } = await import('../src/schema/project.js');
    const data = loadYaml('projects/invalid-unknown-field.yaml');
    const result = validateProjectOverlay(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe('INVALID_PROJECT_OVERLAY');
  });

  it('override provider with plugin field returns INVALID_OVERRIDE_PROVIDER', async () => {
    const { validateProjectOverlay } = await import('../src/schema/project.js');
    const data = loadYaml('projects/invalid-override-provider.yaml');
    const result = validateProjectOverlay(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    // This fails at schema level since project schema only allows projectProvider
    // but the semantic check should also catch it
    expect(result.diagnostics.some(d =>
      d.code === 'INVALID_OVERRIDE_PROVIDER' || d.code === 'INVALID_PROJECT_OVERLAY'
    )).toBe(true);
  });

  it('project overlay with schemaVersion 2 returns SCHEMA_VERSION_UNSUPPORTED', async () => {
    const { validateProjectOverlay } = await import('../src/schema/project.js');
    const data = { schemaVersion: 2 };
    const result = validateProjectOverlay(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('project entry with plugin provider returns INVALID_PROJECT_OVERLAY', async () => {
    const { validateProjectOverlay } = await import('../src/schema/project.js');
    const data = {
      schemaVersion: 1,
      entries: [
        {
          ref: 'test.entry',
          provider: { scope: 'plugin', plugin: 'some-plugin', skill: 'some-skill' },
          kind: 'workflow',
          summary: 'Test',
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only'],
        },
      ],
    };
    const result = validateProjectOverlay(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d =>
      d.code === 'INVALID_PROJECT_OVERLAY'
    )).toBe(true);
  });

  it('override targeting a project entry ref returns INVALID_OVERRIDE_TARGET', async () => {
    const { validateProjectOverlay } = await import('../src/schema/project.js');
    const data = {
      schemaVersion: 1,
      entries: [
        {
          ref: 'project.my-entry',
          provider: { scope: 'project', skill: 'my-skill' },
          kind: 'workflow',
          summary: 'Test',
          match: { domains: ['test'], artifactTypes: ['test'], intents: ['test'] },
          accepts: ['input'],
          produces: ['output'],
          sideEffects: ['read-only'],
        },
      ],
      overrides: {
        'project.my-entry': {
          provider: { scope: 'project', skill: 'override-skill' },
        },
      },
    };
    const result = validateProjectOverlay(data);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_OVERRIDE_TARGET')).toBe(true);
  });

  it('valid minimal project overlay with only schemaVersion passes', async () => {
    const { validateProjectOverlay } = await import('../src/schema/project.js');
    const data = { schemaVersion: 1 };
    const result = validateProjectOverlay(data);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.diagnostics).toHaveLength(0);
  });
});
