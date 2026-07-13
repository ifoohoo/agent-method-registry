import type { Diagnostic, ErrorCode } from '../errors/codes.js';
import type { ProjectProvider } from './catalog.js';
import { validateAgainstSchema } from '../validate/input.js';

// ── Public types ──────────────────────────────────────────────

export type { ProjectProvider };

export interface Override {
  provider: ProjectProvider;
}

export interface ProjectEntry {
  ref: string;
  provider: ProjectProvider;
  kind: 'workflow' | 'operation';
  summary: string;
  match: { domains: string[]; artifactTypes: string[]; intents: string[] };
  accepts: string[];
  produces: string[];
  sideEffects: string[];
}

export interface ProjectOverlayData {
  schemaVersion: number;
  entries?: ProjectEntry[];
  overrides?: Record<string, Override>;
  disabled?: string[];
}

export interface ValidateProjectOverlayResult {
  ok: boolean;
  data?: ProjectOverlayData;
  diagnostics: Diagnostic[];
}

// ── Internal helpers ──────────────────────────────────────────

function diag(code: ErrorCode, message: string, pointer?: string): Diagnostic {
  return {
    code,
    severity: 'error',
    message,
    source: { label: '<project>', pointer },
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

function checkProjectEntryProviders(entries: ProjectEntry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < entries.length; i++) {
    const provider = entries[i].provider;
    if (provider.scope !== 'project') {
      diagnostics.push(
        diag(
          'INVALID_PROJECT_OVERLAY',
          `entries[${i}].provider.scope must be "project", got "${provider.scope}"`,
          `/entries/${i}/provider/scope`
        )
      );
    }
    // Check that no plugin field is present on project providers
    if ('plugin' in provider) {
      diagnostics.push(
        diag(
          'INVALID_PROJECT_OVERLAY',
          `entries[${i}].provider must not have "plugin" field for project scope`,
          `/entries/${i}/provider`
        )
      );
    }
  }
  return diagnostics;
}

function checkOverrideProviders(overrides: Record<string, Override>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [ref, override] of Object.entries(overrides)) {
    const provider = override.provider;
    if (provider.scope !== 'project') {
      diagnostics.push(
        diag(
          'INVALID_OVERRIDE_PROVIDER',
          `overrides["${ref}"].provider.scope must be "project", got "${provider.scope}"`,
          `/overrides/${ref}/provider/scope`
        )
      );
    }
    if ('plugin' in provider) {
      diagnostics.push(
        diag(
          'INVALID_OVERRIDE_PROVIDER',
          `overrides["${ref}"].provider must not have "plugin" field for project scope`,
          `/overrides/${ref}/provider`
        )
      );
    }
  }
  return diagnostics;
}

function checkOverrideTargets(
  entries: ProjectEntry[],
  overrides: Record<string, Override>
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const projectEntryRefs = new Set(entries.map((e) => e.ref));
  for (const ref of Object.keys(overrides)) {
    if (projectEntryRefs.has(ref)) {
      diagnostics.push(
        diag(
          'INVALID_OVERRIDE_TARGET',
          `overrides["${ref}"] targets a project entry ref; only catalog entries can be overridden`,
          `/overrides/${ref}`
        )
      );
    }
  }
  return diagnostics;
}

// ── Public API ────────────────────────────────────────────────

export function validateProjectOverlay(data: unknown): ValidateProjectOverlayResult {
  // 1. Semantic: schemaVersion check (before schema, to get the right error code)
  if (data != null && typeof data === 'object') {
    const schemaVersionDiag = checkSchemaVersion(data as Record<string, unknown>);
    if (schemaVersionDiag) {
      return { ok: false, diagnostics: [schemaVersionDiag] };
    }
  }

  // 2. Schema validation via Ajv
  const schemaResult = validateAgainstSchema('project', data, 'INVALID_PROJECT_OVERLAY');
  if (!schemaResult.valid) {
    return { ok: false, diagnostics: schemaResult.diagnostics };
  }

  const overlayData = schemaResult.data as ProjectOverlayData;
  const diagnostics: Diagnostic[] = [];

  // 3. Project entry providers must use scope: 'project' with skill only
  if (overlayData.entries) {
    diagnostics.push(...checkProjectEntryProviders(overlayData.entries));
  }

  // 4. Override providers must use scope: 'project' with skill only
  if (overlayData.overrides) {
    diagnostics.push(...checkOverrideProviders(overlayData.overrides));

    // 5. Override targets: cannot override a ref that exists in the project's own entries
    if (overlayData.entries) {
      diagnostics.push(...checkOverrideTargets(overlayData.entries, overlayData.overrides));
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }

  return { ok: true, data: overlayData, diagnostics: [] };
}
