import { describe, it, expect } from 'vitest';
import { buildEffectiveIndex } from '../src/resolver/index.js';

describe('reproducibility', () => {
  const catalogData = {
    schemaVersion: 1,
    catalog: { id: 'test-plugin', version: '1.0.0' },
    entries: [
      {
        ref: 'test.entity.action',
        provider: { scope: 'plugin', plugin: 'test-plugin', skill: 'test-skill' },
        kind: 'workflow',
        summary: 'Test entry',
        match: { domains: ['test'], artifactTypes: ['entity'], intents: ['action'] },
        accepts: ['input'],
        produces: ['output'],
        sideEffects: ['read-only'],
      },
      {
        ref: 'test.entity.author',
        provider: { scope: 'plugin', plugin: 'test-plugin', skill: 'author-skill' },
        kind: 'operation',
        summary: 'Author entry',
        match: { domains: ['test'], artifactTypes: ['entity'], intents: ['author'] },
        accepts: ['objective'],
        produces: ['artifact'],
        sideEffects: ['write-project-artifacts'],
      },
    ],
  };

  const projectData = {
    schemaVersion: 1,
    entries: [
      {
        ref: 'project.entity.audit',
        provider: { scope: 'project', skill: 'audit-skill' },
        kind: 'workflow',
        summary: 'Project audit',
        match: { domains: ['project'], artifactTypes: ['entity'], intents: ['audit'] },
        accepts: ['target'],
        produces: ['result'],
        sideEffects: ['write-project-artifacts'],
      },
    ],
    overrides: {
      'test.entity.action': { provider: { scope: 'project', skill: 'override-skill' } },
    },
    disabled: ['test.entity.author'],
  };

  it('same input produces byte-identical index across 10 runs', () => {
    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      const result = buildEffectiveIndex({
        catalogs: [catalogData],
        project: projectData,
      });
      expect(result.ok).toBe(true);
      results.push(JSON.stringify(result.index));
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });

  it('input catalog order does not affect output', () => {
    const catalogA = {
      ...catalogData,
      catalog: { id: 'alpha', version: '1.0.0' },
      entries: catalogData.entries.map(e => ({
        ...e,
        ref: `alpha.${e.ref}`,
        provider: { ...e.provider, plugin: 'alpha' },
      })),
    };
    const catalogB = {
      ...catalogData,
      catalog: { id: 'beta', version: '1.0.0' },
      entries: catalogData.entries.map(e => ({
        ...e,
        ref: `beta.${e.ref}`,
        provider: { ...e.provider, plugin: 'beta' },
      })),
    };

    const r1 = buildEffectiveIndex({ catalogs: [catalogA, catalogB] });
    const r2 = buildEffectiveIndex({ catalogs: [catalogB, catalogA] });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(JSON.stringify(r1.index)).toBe(JSON.stringify(r2.index));
  });

  it('effective index contains no timestamp or transient fields', () => {
    const result = buildEffectiveIndex({
      catalogs: [catalogData],
      project: projectData,
    });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.index);
    expect(serialized).not.toMatch(/timestamp/i);
    expect(serialized).not.toMatch(/"date"/);
    expect(serialized).not.toMatch(/"duration"/);
    expect(serialized).not.toMatch(/"elapsed"/);
  });

  it('effective index contains no verification fields', () => {
    const result = buildEffectiveIndex({
      catalogs: [catalogData],
      project: projectData,
    });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.index);
    expect(serialized).not.toMatch(/providerVerified/);
    expect(serialized).not.toMatch(/"verification"/);
  });
});
