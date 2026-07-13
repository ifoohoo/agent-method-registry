import type { Diagnostic } from '../errors/codes.js';
import { validateAgainstSchema } from '../validate/input.js';

export interface ValidateEffectiveIndexResult {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
}

/**
 * Validate an EffectiveIndex against its JSON Schema + semantic rules.
 * Used by query/resolve/doctor to validate their input index.
 */
export function validateEffectiveIndex(data: unknown): ValidateEffectiveIndexResult {
  const result = validateAgainstSchema('effective-index', data, 'INVALID_EFFECTIVE_INDEX');
  if (!result.valid) {
    return { ok: false, diagnostics: result.diagnostics };
  }
  return { ok: true, data: result.data, diagnostics: [] };
}
