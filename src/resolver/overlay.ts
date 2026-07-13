import type { Entry, Provider } from '../schema/catalog.js';
import type { ProjectOverlayData } from '../schema/project.js';
import type { Diagnostic } from '../errors/codes.js';

export interface DisabledEntry {
  ref: string;
  provider: Provider;
  sourceCatalog: string;
  disabledBy: string;
}

export interface OverlayResult {
  entries: Map<string, Entry>;
  disabledEntries: DisabledEntry[];
  diagnostics: Diagnostic[];
}

/**
 * Apply project overlay to merged catalog entries.
 * - Add project entries (ref must NOT exist in merged → DUPLICATE_PROJECT_ENTRY)
 * - Apply overrides (key must exist in merged catalog entries, NOT in project entries → UNKNOWN_OVERRIDE_REF / INVALID_OVERRIDE_TARGET)
 * - Validate override provider is project variant → INVALID_OVERRIDE_PROVIDER
 * - Apply disabled (ref must exist → UNKNOWN_DISABLED_REF)
 * - Disabled entries become tombstones
 */
export function applyOverlay(
  merged: Map<string, Entry>,
  sourceMap: Map<string, string>,
  overlay: ProjectOverlayData,
): OverlayResult {
  const entries = new Map(merged);
  const disabledEntries: DisabledEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  const projectEntries = overlay.entries ?? [];
  const overrides = overlay.overrides ?? {};
  const disabled = overlay.disabled ?? [];

  // Step 1: Add project entries (must not collide with catalog refs)
  for (const entry of projectEntries) {
    if (merged.has(entry.ref)) {
      diagnostics.push({
        code: 'DUPLICATE_PROJECT_ENTRY',
        severity: 'error',
        message: `Project entry ref "${entry.ref}" duplicates an existing catalog ref; use "overrides" instead`,
        source: { label: '<project>' },
      });
    } else {
      entries.set(entry.ref, entry);
      sourceMap.set(entry.ref, 'project');
    }
  }

  if (diagnostics.length > 0) {
    return { entries, disabledEntries, diagnostics };
  }

  // Step 2: Apply overrides
  for (const [ref, override] of Object.entries(overrides)) {
    if (!merged.has(ref)) {
      // Does not exist in catalog defaults
      if (entries.has(ref)) {
        // Exists as project entry → INVALID_OVERRIDE_TARGET
        diagnostics.push({
          code: 'INVALID_OVERRIDE_TARGET',
          severity: 'error',
          message: `Override for "${ref}" targets a project entry; project entries cannot be overridden`,
          source: { label: '<project>' },
        });
      } else {
        diagnostics.push({
          code: 'UNKNOWN_OVERRIDE_REF',
          severity: 'error',
          message: `Override targets non-existent ref "${ref}"`,
          source: { label: '<project>' },
        });
      }
    } else {
      // Validate provider is project variant
      const provider = override.provider;
      if (provider.scope !== 'project') {
        diagnostics.push({
          code: 'INVALID_OVERRIDE_PROVIDER',
          severity: 'error',
          message: `Override for "${ref}" provider must have scope "project", got "${provider.scope}"`,
          source: { label: '<project>' },
        });
      } else if ('plugin' in provider) {
        diagnostics.push({
          code: 'INVALID_OVERRIDE_PROVIDER',
          severity: 'error',
          message: `Override for "${ref}" provider must not have "plugin" field for project scope`,
          source: { label: '<project>' },
        });
      } else {
        const existing = entries.get(ref)!;
        entries.set(ref, { ...existing, provider });
      }
    }
  }

  if (diagnostics.length > 0) {
    return { entries, disabledEntries, diagnostics };
  }

  // Step 3: Apply disabled
  for (const ref of disabled) {
    const entry = entries.get(ref);
    if (!entry) {
      diagnostics.push({
        code: 'UNKNOWN_DISABLED_REF',
        severity: 'error',
        message: `Disabled targets non-existent ref "${ref}"`,
        source: { label: '<project>' },
      });
    } else {
      const sourceCatalog = sourceMap.get(ref) ?? 'project';
      disabledEntries.push({
        ref,
        provider: { ...entry.provider },
        sourceCatalog,
        disabledBy: 'agent-methods.yaml',
      });
      entries.delete(ref);
    }
  }

  return { entries, disabledEntries, diagnostics };
}
