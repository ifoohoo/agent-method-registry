declare const ERROR_CODES: readonly ["SCHEMA_VERSION_UNSUPPORTED", "INVALID_CATALOG", "INVALID_PROJECT_OVERLAY", "INVALID_EFFECTIVE_INDEX", "INVALID_DIAGNOSTIC_ENVELOPE", "DUPLICATE_CATALOG_ID", "DUPLICATE_DEFAULT_PROVIDER", "DUPLICATE_PROJECT_ENTRY", "UNKNOWN_OVERRIDE_REF", "INVALID_OVERRIDE_TARGET", "INVALID_OVERRIDE_PROVIDER", "UNKNOWN_DISABLED_REF", "PROVIDER_NOT_FOUND", "AMBIGUOUS_PROVIDER", "PROVIDER_UNVERIFIED", "HOST_REQUIRED", "ENTRY_DISABLED", "ENTRY_NOT_FOUND", "NO_QUERY_MATCH", "INVALID_QUERY", "INPUT_READ_FAILED", "OUTPUT_WRITE_FAILED", "STALE_EFFECTIVE_INDEX", "CLI_USAGE_ERROR"];
type ErrorCode = (typeof ERROR_CODES)[number];
interface Diagnostic {
    code: ErrorCode;
    severity: 'error' | 'warn' | 'info';
    message: string;
    source?: {
        label: string;
        pointer?: string;
    };
    suggestion?: string;
}
declare const SOURCE_LABELS: readonly ["<project>", "<catalog:", "<index>", "<external>"];
declare function isValidSourceLabel(label: string): boolean;

export { type Diagnostic as D, type ErrorCode as E, SOURCE_LABELS as S, ERROR_CODES as a, isValidSourceLabel as i };
