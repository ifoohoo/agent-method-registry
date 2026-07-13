/**
 * Canonical JSON serializer.
 * - Object keys sorted by Unicode code point order
 * - Arrays sorted by canonical stringified form (set-like semantics)
 * - No whitespace in output
 *
 * This ensures byte-identical output for logically equivalent input,
 * regardless of key insertion order or array element order.
 */

/**
 * Recursively transform a value into its canonical form.
 * - Objects: keys sorted by Unicode code point, values recursively canonicalized
 * - Arrays: elements sorted by their canonical stringified form (deterministic for
 *   set-like arrays such as domains, artifactTypes, intents, accepts, produces,
 *   sideEffects, disabled; and for entries sorted by ref, catalogs sorted by id)
 * - Primitives: returned as-is
 */
export function canonicalizeJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    // Recursively canonicalize each element, then sort by canonical string
    const canonicalized = value.map(canonicalizeJson);
    return canonicalized.sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return 0;
    });
  }

  // Plain object: sort keys by Unicode code point, recurse values
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(obj[key]);
  }
  return result;
}

/**
 * Produce a canonical JSON string with no whitespace.
 * Equivalent to JSON.stringify(canonicalizeJson(value)).
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}
