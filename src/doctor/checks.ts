// agent-method-registry — Doctor diagnostic checks
// Provides a holistic registry health diagnosis: schema, merge, freshness, provider.

import type { Diagnostic } from '../errors/codes.js';
import { validateCatalog, type CatalogData } from '../schema/catalog.js';
import { validateProjectOverlay, type ProjectOverlayData } from '../schema/project.js';
import { buildEffectiveIndex, type EffectiveIndex } from '../resolver/index.js';
import { computeContentHash } from '../canonicalize/content-hash.js';
import { verifyProvider } from '../provider/verify.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface DiagnoseInput {
  catalogs: unknown[];
  project?: unknown;
  existingIndex?: EffectiveIndex;
  host?: 'claude-code' | 'codex';
  pluginRoots?: Record<string, string[]>;
  projectRoots?: string[];
  strictProvider?: boolean;
}

export interface DoctorCheck {
  id: 'schema' | 'merge' | 'freshness' | 'provider';
  status: 'pass' | 'fail' | 'warn' | 'unverified';
  diagnostics: Diagnostic[];
  target?: string;
}

export interface DiagnoseResult {
  ok: boolean;
  checks: DoctorCheck[];
  diagnostics: Diagnostic[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function makeDiagnostic(code: Diagnostic['code'], severity: Diagnostic['severity'], message: string): Diagnostic {
  return { code, severity, message };
}

// ── Schema check ────────────────────────────────────────────────────────

function runSchemaCheck(input: DiagnoseInput): DoctorCheck {
  const diags: Diagnostic[] = [];
  let target: string | undefined;

  // Validate each catalog
  for (const raw of input.catalogs) {
    const result = validateCatalog(raw);
    if (!result.ok) {
      diags.push(...result.diagnostics);
      // Extract catalog id for target if possible
      const rawObj = raw as Record<string, unknown>;
      const catalog = rawObj?.catalog as Record<string, unknown> | undefined;
      if (typeof catalog?.id === 'string') {
        target = catalog.id;
      }
    }
  }

  // Validate project overlay
  if (input.project !== undefined) {
    const result = validateProjectOverlay(input.project);
    if (!result.ok) {
      diags.push(...result.diagnostics);
    }
  }

  return {
    id: 'schema',
    status: diags.length > 0 ? 'fail' : 'pass',
    diagnostics: diags,
    target,
  };
}

// ── Merge check ─────────────────────────────────────────────────────────

function runMergeCheck(input: DiagnoseInput, schemaPassed: boolean): DoctorCheck {
  if (!schemaPassed) {
    // Merge check is present but effectively skipped when schema fails
    return {
      id: 'merge',
      status: 'pass', // Will be overridden by overall ok=false from schema
      diagnostics: [],
    };
  }

  // Check for duplicate catalog ids
  const ids = new Map<string, number>();
  for (const raw of input.catalogs) {
    const rawObj = raw as Record<string, unknown>;
    const catalog = rawObj?.catalog as Record<string, unknown> | undefined;
    if (typeof catalog?.id === 'string') {
      ids.set(catalog.id, (ids.get(catalog.id) ?? 0) + 1);
    }
  }

  const diags: Diagnostic[] = [];
  for (const [id, count] of ids) {
    if (count > 1) {
      diags.push(makeDiagnostic('DUPLICATE_CATALOG_ID', 'error', `Duplicate catalog id: ${id}`));
    }
  }

  return {
    id: 'merge',
    status: diags.length > 0 ? 'fail' : 'pass',
    diagnostics: diags,
  };
}

// ── Freshness check ─────────────────────────────────────────────────────

function runFreshnessCheck(input: DiagnoseInput, schemaPassed: boolean): DoctorCheck {
  if (!schemaPassed || !input.existingIndex) {
    return {
      id: 'freshness',
      status: 'unverified',
      diagnostics: [],
    };
  }

  // Build current index to compare hashes
  const validatedCatalogs: CatalogData[] = [];
  for (const raw of input.catalogs) {
    const result = validateCatalog(raw);
    if (!result.ok) {
      // Schema should have caught this; skip freshness check
      return { id: 'freshness', status: 'unverified', diagnostics: [] };
    }
    validatedCatalogs.push(result.data!);
  }

  let projectData: ProjectOverlayData | undefined;
  if (input.project !== undefined) {
    const result = validateProjectOverlay(input.project);
    if (!result.ok) {
      return { id: 'freshness', status: 'unverified', diagnostics: [] };
    }
    projectData = result.data!;
  }

  // Compare content hashes
  const existingHashes = input.existingIndex.inputs;
  const diags: Diagnostic[] = [];

  // Check catalog count
  const currentCatalogInputs = validatedCatalogs
    .map(c => ({ id: c.catalog.id, version: c.catalog.version, contentHash: computeContentHash(c) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (currentCatalogInputs.length !== existingHashes.catalogs.length) {
    diags.push(makeDiagnostic('STALE_EFFECTIVE_INDEX', 'error', 'Catalog count mismatch'));
    return { id: 'freshness', status: 'fail', diagnostics: diags };
  }

  // Compare each catalog hash
  for (let i = 0; i < currentCatalogInputs.length; i++) {
    const current = currentCatalogInputs[i];
    const existing = existingHashes.catalogs[i];
    if (current.id !== existing.id || current.contentHash !== existing.contentHash) {
      diags.push(makeDiagnostic('STALE_EFFECTIVE_INDEX', 'error', `Catalog ${current.id} content hash mismatch`));
    }
  }

  // Compare project hash
  const currentProjectHash = projectData ? computeContentHash(projectData) : computeContentHash(null);
  if (currentProjectHash !== existingHashes.projectContentHash) {
    diags.push(makeDiagnostic('STALE_EFFECTIVE_INDEX', 'error', 'Project overlay content hash mismatch'));
  }

  return {
    id: 'freshness',
    status: diags.length > 0 ? 'fail' : 'pass',
    diagnostics: diags,
  };
}

// ── Provider check ──────────────────────────────────────────────────────

function runProviderCheck(input: DiagnoseInput, existingIndex?: EffectiveIndex): DoctorCheck {
  // Must have index and host to proceed with verification
  if (!existingIndex || !input.host) {
    // When roots or strictProvider present but no host, it's a HOST_REQUIRED error
    const hasRootsNoHost = !input.host && (
      (input.pluginRoots && Object.keys(input.pluginRoots).length > 0) ||
      (input.projectRoots && input.projectRoots.length > 0) ||
      input.strictProvider
    );
    if (hasRootsNoHost) {
      return {
        id: 'provider',
        status: 'fail',
        diagnostics: [makeDiagnostic('HOST_REQUIRED', 'error', 'host is required when roots or strictProvider are provided')],
      };
    }
    return {
      id: 'provider',
      status: 'unverified',
      diagnostics: [],
    };
  }

  const hasRoots = (input.pluginRoots && Object.keys(input.pluginRoots).length > 0) ||
    (input.projectRoots && input.projectRoots.length > 0);

  // When strictProvider but no roots, all entries are unverified → error
  if (input.strictProvider && !hasRoots) {
    return {
      id: 'provider',
      status: 'fail',
      diagnostics: [makeDiagnostic('PROVIDER_UNVERIFIED', 'error',
        'strictProvider requires roots for all entries')],
    };
  }

  // When no roots and no strictProvider, just unverified
  if (!hasRoots) {
    return {
      id: 'provider',
      status: 'unverified',
      diagnostics: [],
    };
  }

  const diags: Diagnostic[] = [];
  let target: string | undefined;

  // Verify each entry's provider
  for (const entry of existingIndex.entries) {
    const result = verifyProvider({
      host: input.host,
      pluginRoots: input.pluginRoots,
      projectRoots: input.projectRoots,
      provider: entry.provider,
    });

    if (result.status === 'not-found') {
      diags.push(...result.diagnostics);
      target = entry.ref;
    } else if (result.status === 'ambiguous') {
      diags.push(...result.diagnostics);
      target = entry.ref;
    } else if (result.status === 'unverified' && input.strictProvider) {
      diags.push(makeDiagnostic('PROVIDER_UNVERIFIED', 'error',
        `Provider for "${entry.ref}" could not be verified`));
      target = entry.ref;
    }
  }

  return {
    id: 'provider',
    status: diags.length > 0 ? 'fail' : 'pass',
    diagnostics: diags,
    target,
  };
}

// ── Main diagnosis ──────────────────────────────────────────────────────

export function diagnoseRegistry(input: DiagnoseInput): DiagnoseResult {
  const checks: DoctorCheck[] = [];

  // Schema check
  const schemaCheck = runSchemaCheck(input);
  checks.push(schemaCheck);
  const schemaPassed = schemaCheck.status === 'pass';

  // Merge check
  const mergeCheck = runMergeCheck(input, schemaPassed);
  checks.push(mergeCheck);

  // Freshness check
  const freshnessCheck = runFreshnessCheck(input, schemaPassed);
  checks.push(freshnessCheck);

  // Provider check
  const providerCheck = runProviderCheck(input, schemaPassed ? input.existingIndex : undefined);
  checks.push(providerCheck);

  // Collect all diagnostics
  const allDiagnostics = checks.flatMap(c => c.diagnostics);

  const ok = !allDiagnostics.some(d => d.severity === 'error');

  return { ok, checks, diagnostics: allDiagnostics };
}
