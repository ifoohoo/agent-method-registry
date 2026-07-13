import type { EffectiveIndex, EffectiveEntry } from '../resolver/index.js';
import type { Diagnostic } from '../errors/codes.js';
import { validateEffectiveIndex } from '../schema/effective.js';
import { verifyProvider, type ProviderVerification } from './verify.js';
import { diag } from './verify.js';

export type { ProviderVerification };

export interface ResolveInput {
  index: EffectiveIndex;
  ref: string;
  host?: 'claude-code' | 'codex';
  pluginRoots?: Record<string, string[]>;
  projectRoots?: string[];
  strictProvider?: boolean;
}

export interface ResolveResult {
  ok: boolean;
  data?: { entry: EffectiveEntry; verification?: ProviderVerification };
  diagnostics: Diagnostic[];
}

/**
 * Resolve a single logical ref to its provider.
 * - Validate index first
 * - Look up ref in entries -> not found -> ENTRY_NOT_FOUND
 * - Look up ref in disabledEntries -> found -> ENTRY_DISABLED
 * - If host + roots provided -> verify provider via verifyProvider
 * - If strictProvider and status='unverified' -> PROVIDER_UNVERIFIED error
 * - If roots/strictProvider present but no host -> HOST_REQUIRED
 * - PROVIDER_NOT_FOUND and AMBIGUOUS_PROVIDER are always errors when roots provided
 */
export function resolveEntry(input: ResolveInput): ResolveResult {
  const { index, ref, host, pluginRoots, projectRoots, strictProvider } = input;

  // Check for HOST_REQUIRED: roots or strictProvider present but no host
  const hasRoots =
    (pluginRoots && Object.keys(pluginRoots).length > 0) ||
    (projectRoots && projectRoots.length > 0);
  const needsHost = hasRoots || strictProvider;
  if (needsHost && !host) {
    return {
      ok: false,
      diagnostics: [
        diag(
          'HOST_REQUIRED',
          'host is required when roots or strictProvider are provided'
        ),
      ],
    };
  }

  // Validate index
  const validationResult = validateEffectiveIndex(index);
  if (!validationResult.ok) {
    return {
      ok: false,
      diagnostics: validationResult.diagnostics,
    };
  }

  // Check disabledEntries first
  const disabled = index.disabledEntries.find((e) => e.ref === ref);
  if (disabled) {
    return {
      ok: false,
      diagnostics: [
        diag(
          'ENTRY_DISABLED',
          `Entry "${ref}" is disabled by ${disabled.disabledBy}`
        ),
      ],
    };
  }

  // Look up ref in entries
  const entry = index.entries.find((e) => e.ref === ref);
  if (!entry) {
    return {
      ok: false,
      diagnostics: [
        diag('ENTRY_NOT_FOUND', `Entry "${ref}" not found in effective index`),
      ],
    };
  }

  // If no host provided, return entry without verification
  if (!host) {
    return { ok: true, data: { entry }, diagnostics: [] };
  }

  // If host provided but no roots and no strictProvider, return entry without verification
  if (!hasRoots && !strictProvider) {
    return { ok: true, data: { entry }, diagnostics: [] };
  }

  // Verify provider
  const verificationResult = verifyProvider({
    host,
    pluginRoots,
    projectRoots,
    provider: entry.provider,
  });

  const verification: ProviderVerification = {
    status: verificationResult.status,
    diagnostics: verificationResult.diagnostics,
  };

  // PROVIDER_NOT_FOUND and AMBIGUOUS_PROVIDER are always errors when roots provided
  if (verificationResult.status === 'not-found' && hasRoots) {
    return {
      ok: false,
      diagnostics: verificationResult.diagnostics,
    };
  }

  if (verificationResult.status === 'ambiguous' && hasRoots) {
    return {
      ok: false,
      diagnostics: verificationResult.diagnostics,
    };
  }

  // If strictProvider and status is 'unverified', it's an error
  if (strictProvider && verificationResult.status === 'unverified') {
    return {
      ok: false,
      diagnostics: [
        diag(
          'PROVIDER_UNVERIFIED',
          `Provider for "${ref}" could not be verified; roots not available for plugin "${
            entry.provider.scope === 'plugin' ? entry.provider.plugin : 'project'
          }"`
        ),
      ],
    };
  }

  return { ok: true, data: { entry, verification }, diagnostics: [] };
}
