import { createHash } from 'node:crypto';
import { canonicalStringify } from './entry.js';

/**
 * Compute SHA-256 of canonical JSON serialization.
 * Returns "sha256:<64-hex-lowercase>".
 */
export function computeContentHash(data: unknown): string {
  const canonical = canonicalStringify(data);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${hash}`;
}
