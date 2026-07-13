import { D as Diagnostic } from './codes-BNplwoxd.js';
export { E as ERROR_CODES, a as ErrorCode } from './codes-BNplwoxd.js';

interface SchemaValidationResult {
    valid: boolean;
    diagnostics: Diagnostic[];
    data?: unknown;
}

interface PluginProvider {
    scope: 'plugin';
    plugin: string;
    skill: string;
}
interface ProjectProvider {
    scope: 'project';
    skill: string;
}
type Provider = PluginProvider | ProjectProvider;
interface Entry {
    ref: string;
    provider: Provider;
    kind: 'workflow' | 'operation';
    summary: string;
    match: {
        domains: string[];
        artifactTypes: string[];
        intents: string[];
    };
    accepts: string[];
    produces: string[];
    sideEffects: string[];
}
interface CatalogData {
    schemaVersion: number;
    catalog: {
        id: string;
        version: string;
    };
    entries: Entry[];
}
interface ValidateCatalogResult {
    ok: boolean;
    data?: CatalogData;
    diagnostics: Diagnostic[];
}
declare function validateCatalog(data: unknown): ValidateCatalogResult;

interface Override {
    provider: ProjectProvider;
}
interface ProjectEntry {
    ref: string;
    provider: ProjectProvider;
    kind: 'workflow' | 'operation';
    summary: string;
    match: {
        domains: string[];
        artifactTypes: string[];
        intents: string[];
    };
    accepts: string[];
    produces: string[];
    sideEffects: string[];
}
interface ProjectOverlayData {
    schemaVersion: number;
    entries?: ProjectEntry[];
    overrides?: Record<string, Override>;
    disabled?: string[];
}
interface ValidateProjectOverlayResult {
    ok: boolean;
    data?: ProjectOverlayData;
    diagnostics: Diagnostic[];
}
declare function validateProjectOverlay(data: unknown): ValidateProjectOverlayResult;

interface DisabledEntry {
    ref: string;
    provider: Provider;
    sourceCatalog: string;
    disabledBy: string;
}

interface EffectiveEntry {
    ref: string;
    provider: Provider;
    kind: 'workflow' | 'operation';
    summary: string;
    match: {
        domains: string[];
        artifactTypes: string[];
        intents: string[];
    };
    accepts: string[];
    produces: string[];
    sideEffects: string[];
    provenance: {
        sourceCatalog: string;
        overriddenBy?: string;
    };
}
interface EffectiveIndex {
    schemaVersion: 1;
    inputs: {
        catalogs: Array<{
            id: string;
            version: string;
            contentHash: string;
        }>;
        projectContentHash: string;
    };
    entries: EffectiveEntry[];
    disabledEntries: DisabledEntry[];
}
interface BuildEffectiveIndexInput {
    catalogs: unknown[];
    project?: unknown;
}
interface BuildEffectiveIndexResult {
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
declare function buildEffectiveIndex(input: BuildEffectiveIndexInput): BuildEffectiveIndexResult;

interface ValidateEffectiveIndexResult {
    ok: boolean;
    data?: unknown;
    diagnostics: Diagnostic[];
}

interface QueryInput {
    index: EffectiveIndex;
    domain?: string;
    artifactType?: string;
    intent?: string;
    kind?: 'workflow' | 'operation';
    limit?: number;
    format?: 'compact' | 'full';
}
interface CompactEntry {
    ref: string;
    kind: 'workflow' | 'operation';
    summary: string;
}
interface QueryResult {
    ok: boolean;
    data?: {
        entries: CompactEntry[] | EffectiveEntry[];
    };
    diagnostics: Diagnostic[];
}
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
declare function queryEffectiveIndex(input: QueryInput): QueryResult;

interface VerifyProviderInput {
    host: 'claude-code' | 'codex';
    pluginRoots?: Record<string, string[]>;
    projectRoots?: string[];
    provider: Provider;
}
interface VerifyProviderResult {
    status: 'verified' | 'not-found' | 'ambiguous' | 'unverified';
    diagnostics: Diagnostic[];
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
interface ProviderVerification {
    status: 'verified' | 'not-found' | 'ambiguous' | 'unverified';
    diagnostics: Diagnostic[];
}
declare function verifyProvider(input: VerifyProviderInput): VerifyProviderResult;

interface ResolveInput {
    index: EffectiveIndex;
    ref: string;
    host?: 'claude-code' | 'codex';
    pluginRoots?: Record<string, string[]>;
    projectRoots?: string[];
    strictProvider?: boolean;
}
interface ResolveResult {
    ok: boolean;
    data?: {
        entry: EffectiveEntry;
        verification?: ProviderVerification;
    };
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
declare function resolveEntry(input: ResolveInput): ResolveResult;

interface DiagnoseInput {
    catalogs: unknown[];
    project?: unknown;
    existingIndex?: EffectiveIndex;
    host?: 'claude-code' | 'codex';
    pluginRoots?: Record<string, string[]>;
    projectRoots?: string[];
    strictProvider?: boolean;
}
interface DoctorCheck {
    id: 'schema' | 'merge' | 'freshness' | 'provider';
    status: 'pass' | 'fail' | 'warn' | 'unverified';
    diagnostics: Diagnostic[];
    target?: string;
}
interface DiagnoseResult {
    ok: boolean;
    checks: DoctorCheck[];
    diagnostics: Diagnostic[];
}
declare function diagnoseRegistry(input: DiagnoseInput): DiagnoseResult;

export { type BuildEffectiveIndexInput, type BuildEffectiveIndexResult, type CatalogData, type CompactEntry, type DiagnoseInput, type DiagnoseResult, Diagnostic, type DisabledEntry, type DoctorCheck, type EffectiveEntry, type EffectiveIndex, type Entry, type Override, type PluginProvider, type ProjectOverlayData, type ProjectProvider, type Provider, type ProviderVerification, type QueryInput, type QueryResult, type ResolveInput, type ResolveResult, type SchemaValidationResult, type ValidateCatalogResult, type ValidateEffectiveIndexResult, type ValidateProjectOverlayResult, type VerifyProviderInput, type VerifyProviderResult, buildEffectiveIndex, diagnoseRegistry, queryEffectiveIndex, resolveEntry, validateCatalog, validateProjectOverlay, verifyProvider };
