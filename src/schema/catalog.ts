import type { Diagnostic, ErrorCode } from '../errors/codes.js';
import { validateAgainstSchema } from '../validate/input.js';

// ── Public types ──────────────────────────────────────────────

export interface PluginProvider {
  scope: 'plugin';
  plugin: string;
  skill: string;
}

export interface ProjectProvider {
  scope: 'project';
  skill: string;
}

export type Provider = PluginProvider | ProjectProvider;

export interface Entry {
  ref: string;
  provider: Provider;
  kind: 'workflow' | 'operation';
  summary: string;
  match: { domains: string[]; artifactTypes: string[]; intents: string[] };
  accepts: string[];
  produces: string[];
  sideEffects: string[];
}

export interface CatalogData {
  schemaVersion: number;
  catalog: { id: string; version: string };
  entries: Entry[];
}

export interface ValidateCatalogResult {
  ok: boolean;
  data?: CatalogData;
  diagnostics: Diagnostic[];
}

// ── Internal helpers ──────────────────────────────────────────

function diag(code: ErrorCode, message: string, pointer?: string): Diagnostic {
  return {
    code,
    severity: 'error',
    message,
    source: { label: '<index>', pointer },
  };
}

function checkSchemaVersion(data: Record<string, unknown>): Diagnostic | undefined {
  if (data.schemaVersion !== 1) {
    return diag(
      'SCHEMA_VERSION_UNSUPPORTED',
      `schemaVersion must be 1, got ${JSON.stringify(data.schemaVersion)}`
    );
  }
  return undefined;
}

function checkProviderDiscriminatedUnion(entries: Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const provider = entry.provider;
    if (provider.scope !== 'plugin') {
      diagnostics.push(
        diag(
          'INVALID_CATALOG',
          `entries[${i}].provider.scope must be "plugin", got "${provider.scope}"`,
          `/entries/${i}/provider/scope`
        )
      );
    }
  }
  return diagnostics;
}

function checkPluginMatchesCatalogId(catalogId: string, entries: Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < entries.length; i++) {
    const provider = entries[i].provider;
    if (provider.scope === 'plugin' && provider.plugin !== catalogId) {
      diagnostics.push(
        diag(
          'INVALID_CATALOG',
          `entries[${i}].provider.plugin "${provider.plugin}" must equal catalog.id "${catalogId}"`,
          `/entries/${i}/provider/plugin`
        )
      );
    }
  }
  return diagnostics;
}

function checkSideEffectsConflict(entries: Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < entries.length; i++) {
    const effects = entries[i].sideEffects;
    const hasReadOnly = effects.includes('read-only');
    const hasWrite =
      effects.includes('write-project-artifacts') ||
      effects.includes('external-state-change');
    if (hasReadOnly && hasWrite) {
      diagnostics.push(
        diag(
          'INVALID_CATALOG',
          `entries[${i}].sideEffects: "read-only" cannot coexist with write side effects`,
          `/entries/${i}/sideEffects`
        )
      );
    }
  }
  return diagnostics;
}

function checkRefUniqueness(entries: Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const ref = entries[i].ref;
    if (seen.has(ref)) {
      diagnostics.push(
        diag(
          'INVALID_CATALOG',
          `entries[${i}].ref "${ref}" is duplicated`,
          `/entries/${i}/ref`
        )
      );
    }
    seen.add(ref);
  }
  return diagnostics;
}

function checkSummaryCodePoints(entries: Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < entries.length; i++) {
    const summary = entries[i].summary;
    const len = [...summary].length;
    if (len > 160) {
      diagnostics.push(
        diag(
          'INVALID_CATALOG',
          `entries[${i}].summary exceeds 160 code points (got ${len})`,
          `/entries/${i}/summary`
        )
      );
    }
  }
  return diagnostics;
}

function checkCompactProjectionLimit(entries: Entry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const projection = JSON.stringify({ ref: entry.ref, kind: entry.kind, summary: entry.summary });
    const len = [...projection].length;
    if (len > 400) {
      diagnostics.push(
        diag(
          'INVALID_CATALOG',
          `entries[${i}] compact projection exceeds 400 code points (got ${len})`,
          `/entries/${i}`
        )
      );
    }
  }
  return diagnostics;
}

// ── Public API ────────────────────────────────────────────────

export function validateCatalog(data: unknown): ValidateCatalogResult {
  // 1. Semantic: schemaVersion check (before schema, to get the right error code)
  if (data != null && typeof data === 'object') {
    const schemaVersionDiag = checkSchemaVersion(data as Record<string, unknown>);
    if (schemaVersionDiag) {
      return { ok: false, diagnostics: [schemaVersionDiag] };
    }
  }

  // 2. Schema validation via Ajv
  const schemaResult = validateAgainstSchema('catalog', data, 'INVALID_CATALOG');
  if (!schemaResult.valid) {
    return { ok: false, diagnostics: schemaResult.diagnostics };
  }

  const catalogData = schemaResult.data as CatalogData;
  const diagnostics: Diagnostic[] = [];

  // 3. Provider discriminated union
  diagnostics.push(...checkProviderDiscriminatedUnion(catalogData.entries));

  // 4. plugin == catalog.id
  diagnostics.push(...checkPluginMatchesCatalogId(catalogData.catalog.id, catalogData.entries));

  // 5. sideEffects controlled vocabulary
  diagnostics.push(...checkSideEffectsConflict(catalogData.entries));

  // 6. ref uniqueness
  diagnostics.push(...checkRefUniqueness(catalogData.entries));

  // 7. summary code points
  diagnostics.push(...checkSummaryCodePoints(catalogData.entries));

  // 8. compact projection limit
  diagnostics.push(...checkCompactProjectionLimit(catalogData.entries));

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return { ok: true, data: catalogData, diagnostics: [] };
}
