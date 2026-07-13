import type { CatalogData, Entry } from '../schema/catalog.js';
import type { Diagnostic } from '../errors/codes.js';

export interface MergeResult {
  entries: Map<string, Entry>;
  sourceMap: Map<string, string>;
  diagnostics: Diagnostic[];
}

/**
 * Merge multiple validated catalogs.
 * - Check all catalog.id uniqueness → DUPLICATE_CATALOG_ID
 * - Check ref uniqueness across catalogs → DUPLICATE_DEFAULT_PROVIDER
 * - Return merged entries map, source map, diagnostics
 */
export function mergeCatalogs(catalogs: CatalogData[]): MergeResult {
  const entries = new Map<string, Entry>();
  const sourceMap = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];

  // Step 1: Check catalog.id uniqueness
  const idSet = new Map<string, number>();
  for (let i = 0; i < catalogs.length; i++) {
    const id = catalogs[i].catalog.id;
    const prev = idSet.get(id);
    if (prev !== undefined) {
      diagnostics.push({
        code: 'DUPLICATE_CATALOG_ID',
        severity: 'error',
        message: `Duplicate catalog.id "${id}" at index ${i} (first seen at index ${prev})`,
        source: { label: `<catalog:${id}>` },
      });
    }
    idSet.set(id, i);
  }

  if (diagnostics.length > 0) {
    return { entries, sourceMap, diagnostics };
  }

  // Step 2: Merge entries by ref, detect DUPLICATE_DEFAULT_PROVIDER
  for (const catalog of catalogs) {
    const sourceLabel = `<catalog:${catalog.catalog.id}>`;
    for (const entry of catalog.entries) {
      const existing = entries.get(entry.ref);
      if (existing) {
        diagnostics.push({
          code: 'DUPLICATE_DEFAULT_PROVIDER',
          severity: 'error',
          message: `Duplicate default provider for ref "${entry.ref}" in catalog "${catalog.catalog.id}"; first defined in "${sourceMap.get(entry.ref)}"`,
          source: { label: sourceLabel },
        });
      } else {
        entries.set(entry.ref, entry);
        sourceMap.set(entry.ref, catalog.catalog.id);
      }
    }
  }

  return { entries, sourceMap, diagnostics };
}
