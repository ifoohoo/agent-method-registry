/**
 * Generate test-fixtures/effective-index.json from existing catalog fixtures.
 * Uses only the catalog (no overlay) to avoid disabled-ref conflicts.
 * Run after build: node scripts/generate-fixture.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { buildEffectiveIndex } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const catalogPath = join(root, 'test', 'fixtures', 'catalogs', 'valid-plugin.yaml');
const catalogRaw = readFileSync(catalogPath, 'utf-8');
const catalogData = yamlParse(catalogRaw);

// Build index without overlay to avoid disabled-ref conflict
const result = buildEffectiveIndex({ catalogs: [catalogData] });
if (!result.ok) {
  console.error('Failed to build index:', result.diagnostics);
  process.exit(1);
}

const outDir = join(root, 'test-fixtures');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'effective-index.json');
writeFileSync(outPath, JSON.stringify(result.index, null, 2) + '\n');
console.log('Wrote', outPath);

// Dump content hashes and entry info for fixture setup
console.log('\nContent hashes:');
console.log(JSON.stringify(result.index.inputs, null, 2));
console.log('\nEntries:');
for (const entry of result.index.entries) {
  console.log(`  ${entry.ref} -> provider: ${JSON.stringify(entry.provider)}`);
}
