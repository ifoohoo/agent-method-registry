import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyProvider } from '../src/provider/verify.js';
import { resolveEntry } from '../src/provider/resolve.js';
import type { VerifyProviderInput } from '../src/provider/verify.js';
import type { ResolveInput } from '../src/provider/resolve.js';
import { buildEffectiveIndex } from '../src/resolver/index.js';
import type { EffectiveIndex } from '../src/resolver/index.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'provider-verify-test-'));
}

function createSkillFile(baseDir: string, skill: string, content = '# Skill') {
  const skillDir = join(baseDir, skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content);
}

// ── Shared fixtures ─────────────────────────────────────────────

const VALID_CATALOG = {
  schemaVersion: 1,
  catalog: { id: 'my-plugin', version: '1.0.0' },
  entries: [
    {
      ref: 'my-plugin.entity.author',
      provider: { scope: 'plugin' as const, plugin: 'my-plugin', skill: 'author-skill' },
      kind: 'workflow' as const,
      summary: 'Author entry',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['author'] },
      accepts: ['objective'],
      produces: ['artifact'],
      sideEffects: ['write-project-artifacts'],
    },
    {
      ref: 'my-plugin.entity.validate',
      provider: { scope: 'plugin' as const, plugin: 'my-plugin', skill: 'validate-skill' },
      kind: 'operation' as const,
      summary: 'Validate entry',
      match: { domains: ['artifact'], artifactTypes: ['entity'], intents: ['validate'] },
      accepts: ['artifact'],
      produces: ['validation-result'],
      sideEffects: ['read-only'],
    },
  ],
};

const CATALOG_WITH_PROJECT = {
  schemaVersion: 1,
  catalog: { id: 'proj-plugin', version: '1.0.0' },
  entries: [
    {
      ref: 'proj-plugin.entity.deploy',
      provider: { scope: 'plugin' as const, plugin: 'proj-plugin', skill: 'deploy-skill' },
      kind: 'workflow' as const,
      summary: 'Deploy entry',
      match: { domains: ['deploy'], artifactTypes: ['manifest'], intents: ['deploy'] },
      accepts: ['manifest'],
      produces: ['deployment'],
      sideEffects: ['external-state-change'],
    },
  ],
};

function buildTestIndex(): EffectiveIndex {
  const result = buildEffectiveIndex({
    catalogs: [VALID_CATALOG, CATALOG_WITH_PROJECT],
  });
  expect(result.ok).toBe(true);
  return result.index!;
}

function buildTestIndexWithDisabled(): EffectiveIndex {
  const result = buildEffectiveIndex({
    catalogs: [VALID_CATALOG],
    project: {
      schemaVersion: 1,
      disabled: ['my-plugin.entity.validate'],
    },
  });
  expect(result.ok).toBe(true);
  return result.index!;
}

// ── verifyProvider: Plugin scope ────────────────────────────────

describe('verifyProvider — plugin scope', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns verified when SKILL.md exists for plugin provider', () => {
    const pluginDir = join(tempDir, 'plugins');
    createSkillFile(pluginDir, 'author-skill');

    const result = verifyProvider({
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [pluginDir] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('verified');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('returns PROVIDER_NOT_FOUND when SKILL.md does not exist', () => {
    const pluginDir = join(tempDir, 'plugins');
    mkdirSync(pluginDir, { recursive: true });
    // No author-skill directory created

    const result = verifyProvider({
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [pluginDir] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('not-found');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('PROVIDER_NOT_FOUND');
  });

  it('returns AMBIGUOUS_PROVIDER when multiple SKILL.md hits from different roots', () => {
    const dir1 = join(tempDir, 'root1');
    const dir2 = join(tempDir, 'root2');
    createSkillFile(dir1, 'author-skill', '# Skill from root1');
    createSkillFile(dir2, 'author-skill', '# Skill from root2');

    const result = verifyProvider({
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [dir1, dir2] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('ambiguous');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('AMBIGUOUS_PROVIDER');
  });

  it('returns unverified when no plugin-root for that plugin', () => {
    const result = verifyProvider({
      host: 'claude-code',
      pluginRoots: { 'other-plugin': ['/tmp/some-dir'] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('unverified');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('returns unverified when no pluginRoots provided at all', () => {
    const result = verifyProvider({
      host: 'claude-code',
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('unverified');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ── verifyProvider: Project scope ───────────────────────────────

describe('verifyProvider — project scope', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns verified when SKILL.md exists for project provider', () => {
    createSkillFile(tempDir, 'proj-skill');

    const result = verifyProvider({
      host: 'claude-code',
      projectRoots: [tempDir],
      provider: { scope: 'project', skill: 'proj-skill' },
    });

    expect(result.status).toBe('verified');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('returns PROVIDER_NOT_FOUND when SKILL.md does not exist for project provider', () => {
    mkdirSync(tempDir, { recursive: true });
    // No skill directory created

    const result = verifyProvider({
      host: 'claude-code',
      projectRoots: [tempDir],
      provider: { scope: 'project', skill: 'proj-skill' },
    });

    expect(result.status).toBe('not-found');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('PROVIDER_NOT_FOUND');
  });

  it('returns unverified when no project-root provided', () => {
    const result = verifyProvider({
      host: 'claude-code',
      provider: { scope: 'project', skill: 'proj-skill' },
    });

    expect(result.status).toBe('unverified');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ── verifyProvider: dedup by canonical realpath ─────────────────

describe('verifyProvider — dedup by canonical realpath', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('deduplicates two roots pointing to the same canonical file → single hit (verified)', () => {
    const realDir = join(tempDir, 'real-root');
    createSkillFile(realDir, 'author-skill');

    // Create a symlink to the real directory
    const symlinkDir = join(tempDir, 'symlink-root');
    symlinkSync(realDir, symlinkDir);

    const result = verifyProvider({
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [realDir, symlinkDir] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('verified');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ── verifyProvider: does not recurse ────────────────────────────

describe('verifyProvider — does not recurse', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('only checks exact <dir>/<skill>/SKILL.md, does not recurse into subdirs', () => {
    const pluginDir = join(tempDir, 'plugins');
    // Create nested structure: pluginDir/nested/author-skill/SKILL.md
    const nestedDir = join(pluginDir, 'nested');
    createSkillFile(nestedDir, 'author-skill');

    const result = verifyProvider({
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [pluginDir] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('not-found');
    expect(result.diagnostics[0].code).toBe('PROVIDER_NOT_FOUND');
  });
});

// ── verifyProvider: dual host ───────────────────────────────────

describe('verifyProvider — dual host', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('verifies independently for claude-code and codex with different roots', () => {
    const ccDir = join(tempDir, 'cc-root');
    const codexDir = join(tempDir, 'codex-root');
    createSkillFile(ccDir, 'author-skill');
    // codex root does not have the skill

    const ccResult = verifyProvider({
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [ccDir] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    const codexResult = verifyProvider({
      host: 'codex',
      pluginRoots: { 'my-plugin': [codexDir] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(ccResult.status).toBe('verified');
    expect(codexResult.status).toBe('not-found');
  });
});

// ── verifyProvider: HOST_REQUIRED ───────────────────────────────

describe('verifyProvider — HOST_REQUIRED', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns HOST_REQUIRED when roots provided but host is missing', () => {
    const pluginDir = join(tempDir, 'plugins');
    createSkillFile(pluginDir, 'author-skill');

    const result = verifyProvider({
      host: undefined as unknown as 'claude-code',
      pluginRoots: { 'my-plugin': [pluginDir] },
      provider: { scope: 'plugin', plugin: 'my-plugin', skill: 'author-skill' },
    });

    expect(result.status).toBe('not-found');
    expect(result.diagnostics.some(d => d.code === 'HOST_REQUIRED')).toBe(true);
  });
});

// ── resolveEntry: basic resolution ──────────────────────────────

describe('resolveEntry — basic resolution', () => {
  it('resolves existing enabled entry → ok, entry returned', () => {
    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.entry.ref).toBe('my-plugin.entity.author');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('resolves non-existent ref → ENTRY_NOT_FOUND', () => {
    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'nonexistent.ref',
    });

    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('ENTRY_NOT_FOUND');
  });

  it('resolves disabled ref → ENTRY_DISABLED', () => {
    const index = buildTestIndexWithDisabled();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.validate',
    });

    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('ENTRY_DISABLED');
  });
});

// ── resolveEntry: with host + roots → verification included ────

describe('resolveEntry — with host + roots', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves with host + roots → verification included', () => {
    const pluginDir = join(tempDir, 'plugins');
    createSkillFile(pluginDir, 'author-skill');

    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [pluginDir] },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.verification).toBeDefined();
    expect(result.data!.verification!.status).toBe('verified');
  });

  it('PROVIDER_NOT_FOUND is an error when roots provided', () => {
    const pluginDir = join(tempDir, 'plugins');
    mkdirSync(pluginDir, { recursive: true });
    // No SKILL.md

    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [pluginDir] },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'PROVIDER_NOT_FOUND')).toBe(true);
  });

  it('AMBIGUOUS_PROVIDER is an error when roots provided', () => {
    const dir1 = join(tempDir, 'root1');
    const dir2 = join(tempDir, 'root2');
    createSkillFile(dir1, 'author-skill', '# Skill 1');
    createSkillFile(dir2, 'author-skill', '# Skill 2');

    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [dir1, dir2] },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'AMBIGUOUS_PROVIDER')).toBe(true);
  });
});

// ── resolveEntry: strictProvider ────────────────────────────────

describe('resolveEntry — strictProvider', () => {
  it('strictProvider + unverified → PROVIDER_UNVERIFIED error', () => {
    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      host: 'claude-code',
      strictProvider: true,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'PROVIDER_UNVERIFIED')).toBe(true);
  });

  it('strictProvider + verified → ok', () => {
    const tempDir = makeTempDir();
    const pluginDir = join(tempDir, 'plugins');
    createSkillFile(pluginDir, 'author-skill');

    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      host: 'claude-code',
      pluginRoots: { 'my-plugin': [pluginDir] },
      strictProvider: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data!.verification!.status).toBe('verified');

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('unverified without strictProvider → ok (not an error)', () => {
    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      host: 'claude-code',
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    // No verification since no roots provided
    expect(result.data!.verification).toBeUndefined();
  });
});

// ── resolveEntry: HOST_REQUIRED ─────────────────────────────────

describe('resolveEntry — HOST_REQUIRED', () => {
  it('returns HOST_REQUIRED when roots provided but no host', () => {
    const tempDir = makeTempDir();
    const pluginDir = join(tempDir, 'plugins');
    createSkillFile(pluginDir, 'author-skill');

    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      pluginRoots: { 'my-plugin': [pluginDir] },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'HOST_REQUIRED')).toBe(true);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns HOST_REQUIRED when strictProvider provided but no host', () => {
    const index = buildTestIndex();

    const result = resolveEntry({
      index,
      ref: 'my-plugin.entity.author',
      strictProvider: true,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'HOST_REQUIRED')).toBe(true);
  });
});

// ── resolveEntry: invalid index ─────────────────────────────────

describe('resolveEntry — invalid index', () => {
  it('rejects invalid index → INVALID_EFFECTIVE_INDEX', () => {
    const result = resolveEntry({
      index: { bad: true } as unknown as EffectiveIndex,
      ref: 'any.ref',
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === 'INVALID_EFFECTIVE_INDEX')).toBe(true);
  });
});
