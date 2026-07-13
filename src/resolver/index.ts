import type { CatalogData, Entry, Provider } from '../schema/catalog.js';
import type { ProjectOverlayData } from '../schema/project.js';
import type { Diagnostic } from '../errors/codes.js';
import { validateCatalog } from '../schema/catalog.js';
import { validateProjectOverlay } from '../schema/project.js';
import { computeContentHash } from '../canonicalize/content-hash.js';
import { mergeCatalogs } from './merge.js';
import { applyOverlay, type DisabledEntry } from './overlay.js';

export type { DisabledEntry };

export interface EffectiveEntry {
  ref: string;
  provider: Provider;
  kind: 'workflow' | 'operation';
  summary: string;
  match: { domains: string[]; artifactTypes: string[]; intents: string[] };
  accepts: string[];
  produces: string[];
  sideEffects: string[];
  provenance: {
    sourceCatalog: string;
    overriddenBy?: string;
  };
}

export interface EffectiveIndex {
  schemaVersion: 1;
  inputs: {
    catalogs: Array<{ id: string; version: string; contentHash: string }>;
    projectContentHash: string;
  };
  entries: EffectiveEntry[];
  disabledEntries: DisabledEntry[];
}

export interface BuildEffectiveIndexInput {
  catalogs: unknown[];
  project?: unknown;
}

export interface BuildEffectiveIndexResult {
  ok: boolean;
  index?: EffectiveIndex;
  diagnostics: Diagnostic[];
}

/**
 * Build effective index from raw catalog and project overlay inputs.
 * - Validates each catalog via validateCatalog
 * - Validates project overlay via validateProjectOverlay
 * - Merges catalogs (conflict detection)
 * - Applies overlay (entries, overrides, disabled)
 * - Computes contentHashes via computeContentHash
 * - Sorts entries by ref, disabledEntries by ref
 * - Returns deterministic EffectiveIndex (no timestamps, no verification fields)
 */
export function buildEffectiveIndex(input: BuildEffectiveIndexInput): BuildEffectiveIndexResult {
  const allDiagnostics: Diagnostic[] = [];

  // Step 1: Validate each catalog
  const validatedCatalogs: CatalogData[] = [];
  for (let i = 0; i < input.catalogs.length; i++) {
    const result = validateCatalog(input.catalogs[i]);
    if (!result.ok) {
      allDiagnostics.push(...result.diagnostics);
    } else {
      validatedCatalogs.push(result.data!);
    }
  }
  if (allDiagnostics.length > 0) {
    return { ok: false, diagnostics: allDiagnostics };
  }

  // Step 2: Merge catalogs (conflict detection)
  const mergeResult = mergeCatalogs(validatedCatalogs);
  if (mergeResult.diagnostics.length > 0) {
    return { ok: false, diagnostics: mergeResult.diagnostics };
  }

  // Step 3: Validate and apply project overlay
  let overlayResult: ReturnType<typeof applyOverlay> | null = null;
  let projectData: ProjectOverlayData | undefined;
  if (input.project !== undefined) {
    const result = validateProjectOverlay(input.project);
    if (!result.ok) {
      return { ok: false, diagnostics: result.diagnostics };
    }
    projectData = result.data!;
    overlayResult = applyOverlay(mergeResult.entries, mergeResult.sourceMap, projectData);
    if (overlayResult.diagnostics.length > 0) {
      return { ok: false, diagnostics: overlayResult.diagnostics };
    }
  }

  // Step 4: Build final entries with provenance
  const finalEntries = overlayResult?.entries ?? mergeResult.entries;
  const sortedEntries: EffectiveEntry[] = [...finalEntries.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ref, entry]) => {
      const sourceCatalog = mergeResult.sourceMap.get(ref) ?? 'project';
      const provenance: EffectiveEntry['provenance'] = { sourceCatalog };
      if (overlayResult && projectData?.overrides?.[ref]) {
        provenance.overriddenBy = 'agent-methods.yaml';
      }
      return { ...entry, provenance };
    });

  const sortedDisabled = (overlayResult?.disabledEntries ?? [])
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  // Step 5: Compute content hashes (sorted by catalog id for determinism)
  const catalogInputs = validatedCatalogs
    .map(c => ({
      id: c.catalog.id,
      version: c.catalog.version,
      contentHash: computeContentHash(c),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const index: EffectiveIndex = {
    schemaVersion: 1,
    inputs: {
      catalogs: catalogInputs,
      projectContentHash: projectData ? computeContentHash(projectData) : computeContentHash(null),
    },
    entries: sortedEntries,
    disabledEntries: sortedDisabled,
  };

  return { ok: true, index, diagnostics: [] };
}
