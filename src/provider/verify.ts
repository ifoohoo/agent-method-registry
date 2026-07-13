import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider, PluginProvider, ProjectProvider } from '../schema/catalog.js';
import type { Diagnostic } from '../errors/codes.js';

export interface VerifyProviderInput {
  host: 'claude-code' | 'codex';
  pluginRoots?: Record<string, string[]>;
  projectRoots?: string[];
  provider: Provider;
}

export interface VerifyProviderResult {
  status: 'verified' | 'not-found' | 'ambiguous' | 'unverified';
  diagnostics: Diagnostic[];
}

export function diag(code: Diagnostic['code'], message: string): Diagnostic {
  return {
    code,
    severity: 'error',
    message,
    source: { label: '<external>' },
  };
}

function checkSkillMd(dir: string, skill: string): boolean {
  const skillPath = join(dir, skill, 'SKILL.md');
  return existsSync(skillPath);
}

function resolveCanonical(dir: string, skill: string): string {
  const skillPath = join(dir, skill, 'SKILL.md');
  return realpathSync(skillPath);
}

/**
 * Verify provider discoverability.
 * - scope: plugin -> look up provider.plugin in pluginRoots, check <dir>/<skill>/SKILL.md
 * - scope: project -> use projectRoots, check <root>/<skill>/SKILL.md
 * - Dedup by canonical realpath (same file from different roots = single hit)
 * - 0 hits -> 'not-found' (PROVIDER_NOT_FOUND)
 * - 1 hit -> 'verified'
 * - >1 hits -> 'ambiguous' (AMBIGUOUS_PROVIDER)
 * - No matching root provided -> 'unverified'
 * - Does NOT recurse, only checks exact path <dir>/<skill>/SKILL.md
 */
export interface ProviderVerification {
  status: 'verified' | 'not-found' | 'ambiguous' | 'unverified';
  diagnostics: Diagnostic[];
}

export function verifyProvider(input: VerifyProviderInput): VerifyProviderResult {
  const { host, pluginRoots, projectRoots, provider } = input;

  // HOST_REQUIRED: if roots are provided but host is missing
  const hasRoots =
    (pluginRoots && Object.keys(pluginRoots).length > 0) ||
    (projectRoots && projectRoots.length > 0);
  if (hasRoots && !host) {
    return {
      status: 'not-found',
      diagnostics: [diag('HOST_REQUIRED', 'host is required when roots are provided')],
    };
  }

  let dirs: string[];

  if (provider.scope === 'plugin') {
    const pluginProvider = provider as PluginProvider;
    const roots = pluginRoots?.[pluginProvider.plugin];
    if (!roots || roots.length === 0) {
      return { status: 'unverified', diagnostics: [] };
    }
    dirs = roots;
  } else {
    // project scope
    if (!projectRoots || projectRoots.length === 0) {
      return { status: 'unverified', diagnostics: [] };
    }
    dirs = projectRoots;
  }

  // Collect hits, dedup by canonical realpath
  const canonicalPaths = new Set<string>();
  for (const dir of dirs) {
    if (checkSkillMd(dir, provider.skill)) {
      try {
        const canonical = resolveCanonical(dir, provider.skill);
        canonicalPaths.add(canonical);
      } catch {
        // If realpath fails, treat the path as-is
        const fallback = join(dir, provider.skill, 'SKILL.md');
        canonicalPaths.add(fallback);
      }
    }
  }

  if (canonicalPaths.size === 0) {
    return {
      status: 'not-found',
      diagnostics: [
        diag(
          'PROVIDER_NOT_FOUND',
          `SKILL.md not found for skill "${provider.skill}" in any root`
        ),
      ],
    };
  }

  if (canonicalPaths.size === 1) {
    return { status: 'verified', diagnostics: [] };
  }

  // >1 unique canonical paths
  return {
    status: 'ambiguous',
    diagnostics: [
      diag(
        'AMBIGUOUS_PROVIDER',
        `Multiple SKILL.md files found for skill "${provider.skill}" across roots`
      ),
    ],
  };
}
