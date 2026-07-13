// agent-method-registry — M0+M1 public API
//
// Canonical 7 public functions per design §7.1/§11.2:
//   validateCatalog, validateProjectOverlay, buildEffectiveIndex,
//   queryEffectiveIndex, resolveEntry, verifyProvider, diagnoseRegistry
//
// Non-function runtime exports: ERROR_CODES
// All other symbols (SOURCE_LABELS, isValidSourceLabel, validateAgainstSchema,
// canonicalizeJson, canonicalStringify, computeContentHash, validateEffectiveIndex)
// remain as internal implementation but are NOT re-exported from the package root.

export {
  ERROR_CODES,
} from './errors/codes.js';

export type { ErrorCode, Diagnostic } from './errors/codes.js';

export type { SchemaValidationResult } from './validate/input.js';

export { validateCatalog } from './schema/catalog.js';
export type {
  PluginProvider,
  ProjectProvider,
  Provider,
  Entry,
  CatalogData,
  ValidateCatalogResult,
} from './schema/catalog.js';

export { validateProjectOverlay } from './schema/project.js';
export type {
  Override,
  ProjectOverlayData,
  ValidateProjectOverlayResult,
} from './schema/project.js';

export { buildEffectiveIndex } from './resolver/index.js';
export type {
  BuildEffectiveIndexInput,
  BuildEffectiveIndexResult,
  EffectiveIndex,
  EffectiveEntry,
} from './resolver/index.js';

export type { DisabledEntry } from './resolver/overlay.js';

export type { ValidateEffectiveIndexResult } from './schema/effective.js';

export { queryEffectiveIndex } from './query/engine.js';
export type { QueryInput, CompactEntry, QueryResult } from './query/engine.js';

export { verifyProvider } from './provider/verify.js';
export type { VerifyProviderInput, VerifyProviderResult } from './provider/verify.js';

export { resolveEntry } from './provider/resolve.js';
export type { ResolveInput, ResolveResult, ProviderVerification } from './provider/resolve.js';

export { diagnoseRegistry } from './doctor/checks.js';
export type { DiagnoseInput, DoctorCheck, DiagnoseResult } from './doctor/checks.js';
