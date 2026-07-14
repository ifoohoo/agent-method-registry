/**
 * Public boundary tests — enforce standalone public repo integrity.
 *
 * These tests verify that the package directory does not contain:
 * - Internal docs (hand-back, evidence, process, reviews, superpowers)
 * - Parent-only files (.delivery, artifacts)
 * - Forbidden content patterns (absolute paths, parent references)
 * - Incorrect repository.directory (package lives at root in standalone repo)
 *
 * Parent governance tests (root release scripts, publisher, docs source of truth)
 * live in the parent workspace test/parent-boundary.test.mjs.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGE_DIR = resolve(import.meta.dirname, '..');

// ── Forbidden directories/files ─────────────────────────────────

const FORBIDDEN_PACKAGE_PATHS = [
  'docs',
  'docs/hand-back',
  'docs/evidence',
  'docs/process',
  'docs/reviews',
  'docs/superpowers',
  '.delivery',
  'artifacts',
  'artifact-graph.config.yaml',
];

describe('public boundary — forbidden paths in package', () => {
  it.each(FORBIDDEN_PACKAGE_PATHS)('package must not contain %s', (path) => {
    const fullPath = join(PACKAGE_DIR, path);
    expect(existsSync(fullPath)).toBe(false);
  });
});

// ── Forbidden content patterns ──────────────────────────────────

// Patterns are split to avoid self-matching when this file is scanned.
const _U = '/Users' + '/';
const FORBIDDEN_PATTERNS = [
  _U,
  'artifact-graph' + '-parent',
  'parent' + '-skills',
];

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('public boundary — forbidden content patterns', () => {
  const allFiles = walkFiles(PACKAGE_DIR);

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`no file in package contains "${pattern}"`, () => {
      const violations: string[] = [];
      for (const file of allFiles) {
        try {
          const content = readFileSync(file, 'utf-8');
          if (content.includes(pattern)) {
            violations.push(file.replace(PACKAGE_DIR + '/', ''));
          }
        } catch {
          // Binary file, skip
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

// ── Required public files ───────────────────────────────────────

const REQUIRED_PUBLIC_FILES = [
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'LICENSE',
  'NOTICE',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'INSTALL.md',
];

describe('public boundary — required public files exist', () => {
  it.each(REQUIRED_PUBLIC_FILES)('package contains %s', (file) => {
    expect(existsSync(join(PACKAGE_DIR, file))).toBe(true);
  });
});

// ── package.json files field ────────────────────────────────────

describe('public boundary — package.json files field', () => {
  it('files field includes dist, schemas, and all required public files', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    const files: string[] = pkg.files ?? [];

    expect(files).toContain('dist');
    expect(files).toContain('schemas');

    for (const file of REQUIRED_PUBLIC_FILES) {
      expect(files).toContain(file);
    }
  });

  it('files field does not include src, test, or internal docs', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    const files: string[] = pkg.files ?? [];

    expect(files).not.toContain('src');
    expect(files).not.toContain('test');
    expect(files).not.toContain('docs');
    expect(files).not.toContain('test-fixtures');
  });
});

// ── bin entry ───────────────────────────────────────────────────

describe('public boundary — bin entry', () => {
  it('package.json has correct bin entry', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin['agent-method-registry']).toBe('./dist/bin.js');
  });

  it('license is Apache-2.0', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.license).toBe('Apache-2.0');
  });

  it('engines requires node >=22', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.engines.node).toBe('>=22');
  });

  it('not private', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.private).not.toBe(true);
  });

  it('has description', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(typeof pkg.description).toBe('string');
    expect(pkg.description.length).toBeGreaterThan(0);
  });

  it('has keywords array', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(Array.isArray(pkg.keywords)).toBe(true);
    expect(pkg.keywords.length).toBeGreaterThan(0);
  });

  it('has author set to GitHub handle (not email)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(typeof pkg.author).toBe('string');
    expect(pkg.author).toBe('mzdbxqh');
    expect(pkg.author).not.toContain('@');
  });

  it('has repository pointing to public GitHub repo', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.repository).toBeDefined();
    expect(pkg.repository.type).toBe('git');
    expect(pkg.repository.url).toBe('https://github.com/mzdbxqh/agent-method-registry.git');
  });

  it('standalone repository must not have directory field (package is at root)', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.repository.directory).toBeUndefined();
  });

  it('has bugs.url', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.bugs).toBeDefined();
    expect(pkg.bugs.url).toBe('https://github.com/mzdbxqh/agent-method-registry/issues');
  });

  it('has homepage', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.homepage).toBe('https://github.com/mzdbxqh/agent-method-registry#readme');
  });

  it('has publishConfig.access=public', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.publishConfig).toBeDefined();
    expect(pkg.publishConfig.access).toBe('public');
  });
});

// ── Public docs content checks ─────────────────────────────────

describe('public boundary — whole-tree forbidden content scan', () => {
  it('scans src/, test/, schemas/, test-fixtures/, scripts/ — not just npm tarball files', () => {
    // Verify the whole public source tree is scannable by checking that
    // the walk function visits key subdirectories (including test/).
    const dirs = ['src', 'test', 'schemas', 'test-fixtures', 'scripts'];
    for (const dir of dirs) {
      const fullPath = join(PACKAGE_DIR, dir);
      if (existsSync(fullPath)) {
        // walkFiles should find at least one file in each existing directory
        const files = walkFiles(fullPath);
        expect(files.length).toBeGreaterThan(0);
      }
    }
  });

  it('positive: writing forbidden content into a normal src file would be caught', () => {
    // Prove the scanner catches violations by testing the pattern match logic directly.
    const content = 'const path = "' + _U + 'someone/secrets";';
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(content.includes(pattern)).toBe(pattern === _U);
    }
  });

  it('this test file uses split strings that do NOT match scanner patterns', () => {
    // Verify the split-string trick: this file's own content must not
    // match the FORBIDDEN_PATTERNS values.
    const thisFile = readFileSync(import.meta.filename, 'utf-8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(thisFile.includes(pattern)).toBe(false);
    }
  });
});

// ── README cross-links ─────────────────────────────────────────

describe('public boundary — README cross-links', () => {
  it('README.md links to README.zh-CN.md', () => {
    const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf-8');
    expect(readme).toContain('README.zh-CN.md');
  });

  it('README.zh-CN.md links back to README.md', () => {
    const readme = readFileSync(join(PACKAGE_DIR, 'README.zh-CN.md'), 'utf-8');
    expect(readme).toContain('README.md');
  });

  it('README.md documents exactly 7 functions', () => {
    const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf-8');
    const expectedFunctions = [
      'validateCatalog',
      'validateProjectOverlay',
      'buildEffectiveIndex',
      'queryEffectiveIndex',
      'resolveEntry',
      'verifyProvider',
      'diagnoseRegistry',
    ];
    for (const fn of expectedFunctions) {
      expect(readme).toContain(fn);
    }
  });

  it('README.md documents Node >=22 requirement', () => {
    const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf-8');
    expect(readme).toContain('>=22');
  });

  it('README.md does not contain internal paths', () => {
    const readme = readFileSync(join(PACKAGE_DIR, 'README.md'), 'utf-8');
    expect(readme).not.toContain(_U);
    expect(readme).not.toContain('docs/hand-back');
    expect(readme).not.toContain('.deliv' + 'ery');
  });
});
