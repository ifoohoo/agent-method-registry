# Changelog

## 0.3.1

### Added

- Expanded the unified host registry across `resolve`, `verifyProvider`, `buildEffectiveIndex`, and `diagnoseRegistry` to cover `cursor`, `deepseek-harness` (`dsh`), and Google Antigravity (`antigravity`, `antigravity-ide`, `agy`) four-root discovery paths alongside existing hosts.
- Added the `unbind` CLI subcommand (`--dry-run` supported) to cleanly remove v1 project overrides or v2 `v2-binding` entries while rejecting partial service removal inside atomic family bindings (`BINDING_INVALID`).
- Added top-level `-h` help flag support and complete host-alias suggestions on invalid `--host` diagnostics.

### Fixed

- Hardened path containment and symlink boundary checks during catalog, overlay, and provider verification, and aligned `skill-family-contracts` and `skill-family-harness-node` to `0.39.0`.

### Compatibility

- The package root still exposes the exact seven runtime functions plus `ERROR_CODES`. Existing v1 and v2 runtime APIs, schemas, and CLI exit-code contracts retain their behavior.

## 0.3.0

### Added

- Added `professional-scan` and `read-proof` modes to `diagnoseRegistry`. A scan keeps the existing diagnostic fields and reports the checks it performed. Proof reading interprets an existing Registry conclusion without scanning the target again.
- Added matching `diagnose` CLI modes. The CLI reads explicitly rooted inputs and proofs, and creates a new conclusion only when an output path is supplied. Existing conclusions are never overwritten.
- Adopted `skill-family-contracts@0.22.0` for conclusion validation and `skill-family-harness-node@0.22.0` for strict file reading and exclusive output creation.

### Compatibility

- The package root still exposes exactly seven runtime functions plus `ERROR_CODES`. Existing `diagnoseRegistry` calls and CLI commands retain their behavior.

## 0.2.2

### Fixed

- Fixed the v2 Method Query boundary so Registry-generated `STANDARD`, `THIRD_PARTY`, and
  `PROJECT` service identities can all complete recommendation, prepare, strict resolve, run-lock,
  and pre-execution re-verification.
- Added one internal identity contract for API classification, API/service family matching, and
  `PROJECT` authority consistency across implementation, binding, projection, Method Query, and
  run-lock validation.
- Kept existing service IDs that retain `-family` in the service namespace valid while making the
  suffix-free family namespace the canonical spelling.

### Compatibility

- The package root still exposes exactly seven runtime functions plus `ERROR_CODES`; the internal
  identity helpers are not exported.
- Method Query, prepared handle, run-lock, v1 API, CLI, and digest shapes are unchanged.
- Identity classification checks namespace consistency only. Third-party domain ownership and
  project authority provenance remain external attestation concerns.

## 0.2.1

### Added

- Added public `schemas/adoption-report.schema.json` for machine-verifiable adoption level reports. The schema defines three mutually exclusive outcomes — `v1_compatible`, `v2_adopted`, or `failed` — so that skill-family adoption reports can be deterministically judged by tooling. The file ships in the `schemas/` directory and is exported via the package's `"./schemas/*"` export map entry.

### Fixed

- Corrected documentation that described the published v2 protocol as "unreleased". The v2 protocol has been available since 0.2.0.

### Compatibility

- The package root still exposes exactly seven runtime functions plus `ERROR_CODES`.
- CLI commands and behavior are unchanged.
- Existing v1 and v2 runtime semantics are unchanged.
- This release is an adoption-governance and published-content patch only.

## 0.2.0

### Added

- Added the registry v2 SPI protocol for implementation descriptors, trusted inventory, project
  bindings, capability projection, Method Query strict resolution, and content-bound run locks.
- Added deterministic bundle-tree verification, execution-time re-verification, and orthogonal
  installation/enablement/compatibility/trust/resolution state.
- Added explicit v1-to-v2 migration dry-run, apply, snapshot, collision, source-drift, and rollback
  infrastructure.
- Added public v2 schemas, real plugin-tree fixtures, side-effect budget and `mixSafe`/interop TCK
  gates, plus isolated npm pack/install v2 smoke coverage.
- Added v1-preserving TypeScript overloads, mandatory v2 document discriminators, provider-instance
  identity, binding budget/scope enforcement, implementation-backed interop TCK evidence, and
  drift-safe all-or-nothing rollback preflight.
- Added candidate-to-prepared producer inputs without expanding the seven-function runtime API:
  `inventoryEntries` produces a validated `preparedInventory`, while `methodQueryCandidate`
  accepts a five-field candidate with a complete content-bound Project Facts Evidence envelope
  and produces a snapshot-bound, process-local `preparedQueryHandle` capability without exposing digest helpers.
- Added realpath-based observed evidence that remains available across later trust failures,
  multi-root provider-instance preservation, five-service atomic binding coverage, and full
  dist/tarball query-resolve-run-lock re-verification smoke tests.
- **RecommendationEntry executable discriminant**: recommendation entries carry an `executable`
  boolean derived from the same six-state gate that prepare uses: installation, enablement,
  compatibility, trust, explicit binding, and project-binding must all be satisfied. Consumers
  such as `where-am-i` only need to read `executable` and do not recompute the six-state logic.
  The discriminant is a two-member union: `executable: true` has exact literal types for all six
  states; `executable: false` uses the Registry's published orthogonal literal types.
- Added `ExecutableRecommendationEntry` and `NonExecutableRecommendationEntry` type exports for
  downstream TypeScript consumers.

### Changed

- `RecommendationEntry` is now a discriminated union (`ExecutableRecommendationEntry |
  NonExecutableRecommendationEntry`). The `executable` field is new; existing code that reads
  the six status fields continues to work without changes.
- Copyright attribution is now explicit: the project is maintained by 广州市风荷科技有限公司
  together with `agent-method-registry` contributors under the Apache License 2.0 (see `NOTICE`).
- The public repository moved from `mzdbxqh/agent-method-registry` to
  `ifoohoo/agent-method-registry`; package metadata (`repository`, `bugs`, `homepage`) now points
  to the new location.

### Compatibility

- The package root still exposes exactly seven runtime functions plus `ERROR_CODES`.
- Existing v1 catalog, overlay, query, resolve, provider verification, doctor, and CLI behavior
  remains supported.
- `UNIQUE_COMPATIBLE` resolution can appear in recommendation output but is always `executable: false`.
  The prepare gate continues to reject `UNIQUE_COMPATIBLE` with `NOT_EXECUTABLE`.

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
