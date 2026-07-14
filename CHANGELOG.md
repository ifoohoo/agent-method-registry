# Changelog

## 0.1.1

### Fixed

- Fixed the npm `.bin` and `npx --no-install` entry point silently exiting with code 0
  without executing the requested command.
- Added installed-tarball regression coverage for CLI JSON output, exit codes, provider
  resolution, and effective-index file creation.

Node API exports, schemas, CLI commands, and diagnostic contracts are unchanged.

## 0.1.0

Initial release.

### Features

- **7-function public API**: `validateCatalog`, `validateProjectOverlay`, `buildEffectiveIndex`,
  `queryEffectiveIndex`, `resolveEntry`, `verifyProvider`, `diagnoseRegistry`.
- **CLI commands**: `validate`, `index`, `query`, `resolve` with JSON envelope output.
- **Deterministic effective index**: conflict detection, overlay, tombstones, content hashing.
- **Provider verification**: filesystem-based SKILL.md discovery with dedup, ambiguous detection.
- **Doctor diagnostics**: schema, merge, freshness, and provider health checks.
- **Schema validation**: JSON Schema for catalog, project overlay, effective index, and diagnostic envelope.
- **TypeScript types**: full type exports for all public interfaces.
- **Error codes**: structured `ERROR_CODES` for programmatic error handling.
