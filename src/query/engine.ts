import type { EffectiveIndex, EffectiveEntry } from '../resolver/index.js';
import type { Diagnostic } from '../errors/codes.js';
import { validateEffectiveIndex } from '../schema/effective.js';

export interface QueryInput {
  index: EffectiveIndex;
  domain?: string;
  artifactType?: string;
  intent?: string;
  kind?: 'workflow' | 'operation';
  limit?: number;              // default 8
  format?: 'compact' | 'full'; // default 'compact'
}

export interface CompactEntry {
  ref: string;
  kind: 'workflow' | 'operation';
  summary: string;
}

export interface QueryResult {
  ok: boolean;
  data?: { entries: CompactEntry[] | EffectiveEntry[] };
  diagnostics: Diagnostic[];
}

const DEFAULT_LIMIT = 8;
const VALID_FORMATS = new Set(['compact', 'full']);

/**
 * Query an EffectiveIndex with structured filters.
 * - Validates index via validateEffectiveIndex first
 * - Filters by domain/artifactType/intent/kind (all optional, AND logic)
 * - Sorted by ref (already sorted in index)
 * - Limit: default 8
 * - compact mode: project {ref, kind, summary} only, verify 400 code points limit
 * - full mode: return complete EffectiveEntry
 * - No match -> ok:true with empty array + NO_QUERY_MATCH info diagnostic
 * - Invalid input -> INVALID_QUERY error
 */
export function queryEffectiveIndex(input: QueryInput): QueryResult {
  const diagnostics: Diagnostic[] = [];

  // Step 1: Validate the index
  const indexValidation = validateEffectiveIndex(input.index);
  if (!indexValidation.ok) {
    return { ok: false, diagnostics: indexValidation.diagnostics };
  }

  // Step 2: Validate limit
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (input.limit !== undefined) {
    if (!Number.isInteger(limit) || limit <= 0) {
      return {
        ok: false,
        diagnostics: [{
          code: 'INVALID_QUERY',
          severity: 'error',
          message: `Invalid limit: must be a positive integer, got ${input.limit}`,
        }],
      };
    }
  }

  // Step 3: Validate format
  const format = input.format ?? 'compact';
  if (input.format !== undefined && !VALID_FORMATS.has(input.format)) {
    return {
      ok: false,
      diagnostics: [{
        code: 'INVALID_QUERY',
        severity: 'error',
        message: `Invalid format: must be 'compact' or 'full', got '${input.format}'`,
      }],
    };
  }

  // Step 4: Filter entries (AND logic across all filters)
  let filtered = input.index.entries;

  if (input.domain !== undefined) {
    filtered = filtered.filter(e => e.match.domains.includes(input.domain!));
  }

  if (input.artifactType !== undefined) {
    filtered = filtered.filter(e => e.match.artifactTypes.includes(input.artifactType!));
  }

  if (input.intent !== undefined) {
    filtered = filtered.filter(e => e.match.intents.includes(input.intent!));
  }

  if (input.kind !== undefined) {
    filtered = filtered.filter(e => e.kind === input.kind);
  }

  // Step 5: Apply limit
  const limited = filtered.slice(0, limit);

  // Step 6: No match -> info diagnostic
  if (limited.length === 0) {
    diagnostics.push({
      code: 'NO_QUERY_MATCH',
      severity: 'info',
      message: 'No entries matched the query filters',
    });
  }

  // Step 7: Format output
  if (format === 'compact') {
    const entries: CompactEntry[] = limited.map(e => ({
      ref: e.ref,
      kind: e.kind,
      summary: e.summary,
    }));
    return { ok: true, data: { entries }, diagnostics };
  }

  // full mode: return complete EffectiveEntry
  return { ok: true, data: { entries: limited }, diagnostics };
}
