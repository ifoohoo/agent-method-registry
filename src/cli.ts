// agent-method-registry — CLI logic (importable, no auto-execution)
// Hand-written argument parsing (no commander/yargs/etc.)

import { readFileSync, writeFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import type { Diagnostic } from './errors/codes.js';
import { validateCatalog } from './schema/catalog.js';
import { validateProjectOverlay } from './schema/project.js';
import { buildEffectiveIndex } from './resolver/index.js';
import { queryEffectiveIndex } from './query/engine.js';
import { resolveEntry } from './provider/resolve.js';
import { validateEffectiveIndex } from './schema/effective.js';
import type { EffectiveIndex } from './resolver/index.js';

// ── Argument parsing ─────────────────────────────────────────────

export interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  flags: Record<string, string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node and script path
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  let command: string | undefined;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const flagName = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        // --flag value
        const value = args[i + 1];
        if (!flags[flagName]) flags[flagName] = [];
        flags[flagName].push(value);
        i += 2;
      } else {
        // bare flag — store empty string
        if (!flags[flagName]) flags[flagName] = [];
        flags[flagName].push('');
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  command = positional[0];
  return { command, positional, flags };
}

export function hasFlag(parsed: ParsedArgs, name: string): boolean {
  return name in parsed.flags;
}

export function getFlag(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.flags[name]?.[0];
}

export function getAllFlags(parsed: ParsedArgs, name: string): string[] {
  return parsed.flags[name] ?? [];
}

// ── Unified diagnostic envelope output (spec §8.2) ──────────────

interface Envelope {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
}

export class ExitError extends Error {
  constructor(public readonly exitCode: number) {
    super(`process.exit(${exitCode})`);
    this.name = 'ExitError';
  }
}

export function emit(envelope: Envelope, exitCode: number): never {
  process.stdout.write(JSON.stringify(envelope) + '\n');
  process.exit(exitCode);
  // In tests where process.exit is mocked, we need to halt execution
  throw new ExitError(exitCode);
}

// ── YAML/JSON file IO ────────────────────────────────────────────

export function readInput(
  filePath: string
): { ok: true; data: unknown } | { ok: false; diagnostics: Diagnostic[] } {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [
        {
          code: 'INPUT_READ_FAILED',
          severity: 'error',
          message: `Failed to read ${filePath}: ${message}`,
        },
      ],
    };
  }

  try {
    const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml');
    const data = isYaml ? yamlParse(raw) : JSON.parse(raw);
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [
        {
          code: 'INPUT_READ_FAILED',
          severity: 'error',
          message: `Failed to parse ${filePath}: ${message}`,
        },
      ],
    };
  }
}

export function writeOutput(
  filePath: string,
  data: unknown
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [
        {
          code: 'OUTPUT_WRITE_FAILED',
          severity: 'error',
          message: `Failed to write ${filePath}: ${message}`,
        },
      ],
    };
  }
}

// ── Shared CLI helpers ───────────────────────────────────────────

function usageError(message: string): never {
  emit(
    { ok: false, diagnostics: [{ code: 'CLI_USAGE_ERROR', severity: 'error', message }] },
    2,
  );
}

function requireFlag(parsed: ParsedArgs, name: string): string {
  if (!hasFlag(parsed, name)) {
    usageError(`Missing required --${name} flag`);
  }
  const values = getAllFlags(parsed, name);
  if (values.length > 1) {
    usageError(`Duplicate --${name} flag`);
  }
  if (values[0] === '') {
    usageError(`--${name} requires a value`);
  }
  return values[0];
}

function optionalSingleton(parsed: ParsedArgs, name: string): string | undefined {
  if (!hasFlag(parsed, name)) return undefined;
  const values = getAllFlags(parsed, name);
  if (values.length > 1) {
    usageError(`Duplicate --${name} flag`);
  }
  if (values[0] === '') {
    usageError(`--${name} requires a value`);
  }
  return values[0];
}

const QUERY_ALLOWED_FLAGS = new Set([
  'index', 'domain', 'artifact-type', 'intent', 'kind', 'limit', 'format',
]);

const RESOLVE_ALLOWED_FLAGS = new Set([
  'index', 'ref', 'host', 'plugin-root', 'project-root',
]);

function rejectUnknownFlags(parsed: ParsedArgs, allowed: Set<string>): void {
  for (const flag of Object.keys(parsed.flags)) {
    if (!allowed.has(flag)) {
      usageError(`Unknown flag: --${flag}`);
    }
  }
}

function rejectExtraPositionals(parsed: ParsedArgs, maxPositionals: number): void {
  if (parsed.positional.length > maxPositionals) {
    usageError(`Unexpected argument: ${parsed.positional[maxPositionals]}`);
  }
}

function requireNonEmptyRepeated(parsed: ParsedArgs, name: string): string[] {
  const values = getAllFlags(parsed, name);
  for (const v of values) {
    if (v === '') {
      usageError(`--${name} requires a value`);
    }
  }
  return values;
}

function stripHashPrefix(hash: string): string {
  const idx = hash.indexOf(':');
  return idx >= 0 ? hash.slice(idx + 1) : hash;
}

// ── Commands ─────────────────────────────────────────────────────

function cmdValidate(parsed: ParsedArgs): void {
  const catalogPaths = requireNonEmptyRepeated(parsed, 'catalog');
  if (catalogPaths.length === 0) {
    emit(
      {
        ok: false,
        diagnostics: [
          {
            code: 'CLI_USAGE_ERROR',
            severity: 'error',
            message: 'validate requires at least one --catalog <file>',
          },
        ],
      },
      2
    );
  }

  // Read and validate each catalog
  const allDiagnostics: Diagnostic[] = [];
  for (const catalogPath of catalogPaths) {
    const input = readInput(catalogPath);
    if (!input.ok) {
      allDiagnostics.push(...input.diagnostics);
      continue;
    }
    const result = validateCatalog(input.data);
    if (!result.ok) {
      allDiagnostics.push(...result.diagnostics);
    }
  }

  // Validate project overlay if provided
  if (hasFlag(parsed, 'project')) {
    const projectPath = getFlag(parsed, 'project')!;
    const input = readInput(projectPath);
    if (!input.ok) {
      allDiagnostics.push(...input.diagnostics);
    } else {
      const result = validateProjectOverlay(input.data);
      if (!result.ok) {
        allDiagnostics.push(...result.diagnostics);
      }
    }
  }

  if (allDiagnostics.length > 0) {
    emit({ ok: false, diagnostics: allDiagnostics }, 1);
  }

  emit({ ok: true, data: null, diagnostics: [] }, 0);
}

function cmdIndex(parsed: ParsedArgs): void {
  const catalogPaths = requireNonEmptyRepeated(parsed, 'catalog');
  if (catalogPaths.length === 0) {
    emit(
      {
        ok: false,
        diagnostics: [
          {
            code: 'CLI_USAGE_ERROR',
            severity: 'error',
            message: 'index requires at least one --catalog <file>',
          },
        ],
      },
      2
    );
  }

  // Read catalogs
  const catalogDatas: unknown[] = [];
  const readDiagnostics: Diagnostic[] = [];
  for (const catalogPath of catalogPaths) {
    const input = readInput(catalogPath);
    if (!input.ok) {
      readDiagnostics.push(...input.diagnostics);
    } else {
      catalogDatas.push(input.data);
    }
  }
  if (readDiagnostics.length > 0) {
    emit({ ok: false, diagnostics: readDiagnostics }, 1);
  }

  // Read project overlay if provided
  let projectData: unknown | undefined;
  if (hasFlag(parsed, 'project')) {
    const projectPath = getFlag(parsed, 'project')!;
    const input = readInput(projectPath);
    if (!input.ok) {
      emit({ ok: false, diagnostics: input.diagnostics }, 1);
    }
    projectData = input.ok ? input.data : undefined;
  }

  // Build effective index
  const result = buildEffectiveIndex({
    catalogs: catalogDatas,
    project: projectData,
  });

  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }

  // Write to --out if specified (raw index, no envelope)
  if (hasFlag(parsed, 'out')) {
    const outPath = getFlag(parsed, 'out')!;
    const writeResult = writeOutput(outPath, result.index);
    if (!writeResult.ok) {
      emit({ ok: false, diagnostics: writeResult.diagnostics }, 1);
    }
  }

  emit({ ok: true, data: result.index, diagnostics: [] }, 0);
}

function cmdQuery(parsed: ParsedArgs): void {
  rejectUnknownFlags(parsed, QUERY_ALLOWED_FLAGS);
  rejectExtraPositionals(parsed, 1);

  const indexPath = requireFlag(parsed, 'index');

  // Validate optional singletons
  const domain = optionalSingleton(parsed, 'domain');
  const artifactType = optionalSingleton(parsed, 'artifact-type');
  const intent = optionalSingleton(parsed, 'intent');
  const kindStr = optionalSingleton(parsed, 'kind');
  const limitStr = optionalSingleton(parsed, 'limit');
  const formatStr = optionalSingleton(parsed, 'format');

  // Validate kind
  if (kindStr !== undefined && kindStr !== 'workflow' && kindStr !== 'operation') {
    usageError(`Invalid --kind value: ${JSON.stringify(kindStr)}. Must be 'workflow' or 'operation'`);
  }
  const kind = kindStr as 'workflow' | 'operation' | undefined;

  // Validate format
  if (formatStr !== undefined && formatStr !== 'compact' && formatStr !== 'full') {
    usageError(`Invalid --format value: ${JSON.stringify(formatStr)}. Must be 'compact' or 'full'`);
  }
  const format = formatStr as 'compact' | 'full' | undefined;

  // Validate limit
  let limit: number | undefined;
  if (limitStr !== undefined) {
    const parsed_limit = Number(limitStr);
    if (!Number.isInteger(parsed_limit) || parsed_limit < 1 || parsed_limit > 8) {
      usageError(`Invalid --limit value: ${JSON.stringify(limitStr)}. Must be an integer between 1 and 8`);
    }
    limit = parsed_limit;
  }

  // Read and validate the effective index
  const input = readInput(indexPath);
  if (!input.ok) {
    emit({ ok: false, diagnostics: input.diagnostics }, 1);
  }

  // Query
  const result = queryEffectiveIndex({
    index: input.data as EffectiveIndex,
    domain,
    artifactType,
    intent,
    kind,
    limit,
    format,
  });

  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }

  // exit 0 for success including no-match (NO_QUERY_MATCH is info severity)
  const hasOnlyInfoDiagnostics = result.diagnostics.every(d => d.severity === 'info');
  emit(
    { ok: true, data: result.data ?? null, diagnostics: result.diagnostics },
    hasOnlyInfoDiagnostics ? 0 : 1,
  );
}

function cmdResolve(parsed: ParsedArgs): void {
  rejectUnknownFlags(parsed, RESOLVE_ALLOWED_FLAGS);
  rejectExtraPositionals(parsed, 1);

  const indexPath = requireFlag(parsed, 'index');
  const ref = requireFlag(parsed, 'ref');
  const hostStr = requireFlag(parsed, 'host');

  // Validate host
  if (hostStr !== 'claude-code' && hostStr !== 'codex') {
    usageError(`Invalid --host value: ${JSON.stringify(hostStr)}. Must be 'claude-code' or 'codex'`);
  }
  const host = hostStr as 'claude-code' | 'codex';

  const pluginRootValues = requireNonEmptyRepeated(parsed, 'plugin-root');
  const projectRootValues = requireNonEmptyRepeated(parsed, 'project-root');

  // Read and validate the effective index
  const input = readInput(indexPath);
  if (!input.ok) {
    emit({ ok: false, diagnostics: input.diagnostics }, 1);
  }

  const index = input.data as EffectiveIndex;

  // Validate the effective index schema before accessing any fields.
  // This catches malformed providers, missing required fields, etc.
  // and prevents TypeErrors from premature field access (e.g. entry.provider.scope).
  const indexValidation = validateEffectiveIndex(index);
  if (!indexValidation.ok) {
    emit({ ok: false, diagnostics: indexValidation.diagnostics }, 1);
  }

  // Schema validation passed — safe to access index fields.
  const entry = index.entries.find(e => e.ref === ref);
  if (!entry) {
    // Check disabled entries
    const disabled = index.disabledEntries?.find(e => e.ref === ref);
    if (disabled) {
      emit({
        ok: false,
        diagnostics: [{
          code: 'ENTRY_DISABLED',
          severity: 'error',
          message: `Entry "${ref}" is disabled by ${disabled.disabledBy}`,
          source: { label: '<external>' },
        }],
      }, 1);
    }
    emit({
      ok: false,
      diagnostics: [{
        code: 'ENTRY_NOT_FOUND',
        severity: 'error',
        message: `Entry "${ref}" not found in effective index`,
        source: { label: '<external>' },
      }],
    }, 1);
  }

  // Map plugin roots to the entry's plugin id
  let pluginRoots: Record<string, string[]> | undefined;
  if (pluginRootValues.length > 0 && entry.provider.scope === 'plugin') {
    pluginRoots = { [entry.provider.plugin]: pluginRootValues };
  }

  const projectRoots = projectRootValues.length > 0 ? projectRootValues : undefined;

  // Resolve with strictProvider
  const result = resolveEntry({
    index,
    ref,
    host,
    pluginRoots,
    projectRoots,
    strictProvider: true,
  });

  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }

  // Build verification with host
  // (status defaults to 'unverified' when verification not performed — defensive guard)
  const verification: { status: string; host: string; diagnostics: Diagnostic[] } = {
    status: result.data!.verification?.status ?? 'unverified',
    host,
    diagnostics: result.data!.verification?.diagnostics ?? [],
  };

  // Build index_content_hashes: strip sha256: prefix
  const indexInputs = index.inputs;
  const catalogsHashes: Record<string, string> = {};
  for (const cat of indexInputs.catalogs) {
    catalogsHashes[cat.id] = stripHashPrefix(cat.contentHash);
  }
  const indexContentHashes = {
    catalogs: catalogsHashes,
    project: stripHashPrefix(indexInputs.projectContentHash),
  };

  emit(
    {
      ok: true,
      data: {
        entry: result.data!.entry,
        verification,
        index_content_hashes: indexContentHashes,
      },
      diagnostics: result.diagnostics,
    },
    0,
  );
}

// ── Main ─────────────────────────────────────────────────────────

export function run(argv: string[]): void {
  const parsed = parseArgs(argv);

  switch (parsed.command) {
    case 'validate':
      cmdValidate(parsed);
      break;
    case 'index':
      cmdIndex(parsed);
      break;
    case 'query':
      cmdQuery(parsed);
      break;
    case 'resolve':
      cmdResolve(parsed);
      break;
    default:
      emit(
        {
          ok: false,
          diagnostics: [
            {
              code: 'CLI_USAGE_ERROR',
              severity: 'error',
              message: parsed.command
                ? `Unknown command: ${parsed.command}`
                : 'No command specified. Use: validate | index | query | resolve',
            },
          ],
        },
        2
      );
  }
}
