import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Diagnostic, ErrorCode } from '../errors/codes.js';
import type { ValidateFunction, ErrorObject } from 'ajv';

const require = createRequire(import.meta.url);

// CJS interop: ajv and ajv-formats are CJS packages without ESM exports compatible with module: "NodeNext"
interface AjvInstance {
  compile(schema: unknown): ValidateFunction;
}
type AjvConstructor = new (options?: Record<string, unknown>) => AjvInstance;
type AddFormatsFn = (ajv: AjvInstance) => void;

const AjvConstructor: AjvConstructor = require('ajv');
const addFormatsFn: AddFormatsFn = require('ajv-formats');

const __dirname = dirname(fileURLToPath(import.meta.url));
// Source mode: src/validate/ → ../../schemas (→ packages/agent-method-registry/schemas)
// Bundled mode: dist/ → ../schemas (→ packages/agent-method-registry/schemas)
const SCHEMAS_DIR = ((): string => {
  const srcPath = resolve(__dirname, '../../schemas');
  if (existsSync(srcPath)) return srcPath;
  const distPath = resolve(__dirname, '../schemas');
  return distPath;
})();

type SchemaName = 'catalog' | 'project' | 'effective-index' | 'diagnostic-envelope';

const ajv = new AjvConstructor({ allErrors: true, strict: true });
addFormatsFn(ajv);

const schemaCache = new Map<string, ValidateFunction>();

function getValidator(schemaName: SchemaName): ValidateFunction {
  const cached = schemaCache.get(schemaName);
  if (cached) return cached;
  const raw = readFileSync(resolve(SCHEMAS_DIR, `${schemaName}.schema.json`), 'utf-8');
  const schema = JSON.parse(raw);
  const validator = ajv.compile(schema);
  schemaCache.set(schemaName, validator);
  return validator;
}

export interface SchemaValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
  data?: unknown;
}

export function validateAgainstSchema(
  schemaName: SchemaName,
  data: unknown,
  failureCode: ErrorCode
): SchemaValidationResult {
  const validate = getValidator(schemaName);
  const valid = validate(data);
  if (valid) {
    return { valid: true, diagnostics: [], data };
  }
  const diagnostics: Diagnostic[] = (validate.errors || []).map((err: ErrorObject) => ({
    code: failureCode,
    severity: 'error' as const,
    message: `${err.instancePath || '/'} ${err.message || 'validation failed'}`,
    source: {
      label:
        schemaName === 'project'
          ? '<project>'
          : schemaName === 'diagnostic-envelope'
            ? '<external>'
            : '<index>',
    },
  }));
  return { valid: false, diagnostics };
}
