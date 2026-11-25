# agent-method-registry

[中文](README.zh-CN.md)

`agent-method-registry` is a deterministic local registry for agent method discovery, project-level overrides, multi-host provider verification, safe capability unbinding, and health diagnostics. Instead of hardcoding plugin paths inside scripts or prompts, callers resolve stable logical method IDs while enforcing schema contracts, host identity, and filesystem integrity.

## Protocol overview

The package supports both protocol generations behind an invariant **7-function + `ERROR_CODES`** root API:

- **v1 catalog & project overlay**: lightweight cross-plugin method registration (`catalog.yaml` / `catalog.json`), project-local additions, overrides, and tombstones (`agent-methods.yaml`), multi-dimensional filtering, `SKILL.md` realpath verification, and idempotent capability unbinding (`unbind`).
- **v2 skill-family SPI & run-lock (available since `0.2.0`)**: contract-backed family runtime chain connecting Family APIs, implementation descriptors (`v2-implementation`), trusted host inventories (`v2-inventory`), capability projections (`v2-projection`), explicit project bindings (`v2-binding`), content-bound `Method Query` envelopes, and 16-field `RunMethodLock` re-verification (`v2-run-lock`).

## Core guarantees

1. **Orthogonal six-state model (fail-closed)**: installation (`INSTALLED`), enablement (`ENABLED`), API compatibility (`COMPATIBLE`), filesystem trust (`VERIFIED`), unique resolution (`EXPLICIT_BINDING`), and `project-binding` selection source are tracked independently. Zero or multiple eligible candidates always fail closed — the registry never falls back to the first entry, highest version, or an undeclared default.
2. **Single `executable` discriminant**: every v2 recommendation entry carries an `executable` boolean computed by the exact same six-state gate used during `prepare`. Entry routers such as `where-am-i` read `executable` directly without recomputing state combinations. `UNIQUE_COMPATIBLE` entries remain visible in recommendations with `executable: false`.
3. **Unified multi-host isolation & pre-execution re-verification**: natively supports `codex`, `claude-code` (compatible with `claude` alias), `antigravity` (compatible with `antigravity-ide` and `agy` CLI aliases, covering `.agents/skills`, `.agent/skills`, `~/.gemini/config/skills`, and `~/.gemini/config/plugins/*/skills`), `kimi` (compatible with Foundation `kimi-code` host profiles), `qoder`, `codebuddy`, `workbuddy`, `grok`, `cursor`, and `deepseek-harness` (compatible with `dsh` alias). `RunMethodLock` binds both host identity and bundle tree SHA-256 digests; cross-host invocations or post-lock file edits fail closed with `HOST_MISMATCH` or `BUNDLE_DIGEST_MISMATCH`.

### Namespace classification

Supported Family APIs and service IDs are deterministically classified into three namespaces:

```text
STANDARD     artifact.<family>-family              → artifact.<family>.<service>
THIRD_PARTY  <reverse-domain>.<family>-family      → <reverse-domain>.<family>.<service>
PROJECT      project.<authority>.<family>-family   → project.<authority>.<family>.<service>
             (requires consistent projectAuthority = project.<authority> end to end)
```

Legacy v2 service IDs retaining `-family` before the service segment remain valid for backward compatibility; new descriptors should use the suffix-free service namespace. Namespace classification enforces structural consistency, while external domain/authority provenance is handled by separate attestation protocols.

## Installation

Requires Node.js `>=22.0.0`.

```bash
npm install agent-method-registry
```

## Public API (7 root functions)

```javascript
import {
  validateCatalog,
  validateProjectOverlay,
  buildEffectiveIndex,
  queryEffectiveIndex,
  resolveEntry,
  verifyProvider,
  diagnoseRegistry,
  ERROR_CODES,
} from 'agent-method-registry';
```

| Function | Responsibility |
|----------|----------------|
| `validateCatalog` | Validate a v1 plugin catalog or explicitly discriminated v2 implementation, inventory, run-lock, or migration-plan document |
| `validateProjectOverlay` | Validate a v1 project overlay (`agent-methods.yaml`) or a v2 project binding / capability projection document |
| `buildEffectiveIndex` | Build a deterministic v1 effective index, or normalize v2 candidate installations (`preparedInventory`) and compute capability projections |
| `queryEffectiveIndex` | Filter a v1 index, run read-only v2 `recommendation` queries, or `prepare` an authorized v2 execution with a process-local `preparedQueryHandle` |
| `resolveEntry` | Resolve v1 entries with host root verification, or run v2 strict resolution and mint a content-bound `runMethodLock` |
| `verifyProvider` | Verify v1 `SKILL.md` paths or re-verify v2 inventory instances and run locks against realpaths, host identity, and bundle digests |
| `diagnoseRegistry` | Run synchronous health checks (`schema`, `merge`, `freshness`, `provider`, `v2-*`), `professional-scan`, or `read-proof` without adding an eighth export |

JSON Schemas are exported via package subpaths such as `agent-method-registry/schemas/inventory.schema.json` without expanding the 7-function root API.
### Professional scan and proof reading

Omitting `mode` runs standard synchronous diagnosis. Passing `mode` produces or interprets Foundation `skill-family.professional-conclusion` proofs through the same function:

```javascript
const scanned = diagnoseRegistry({
  mode: 'professional-scan',
  subject: { ref: 'my-registry' },
  request: { catalogs: [catalogData] }, // explicit DiagnoseInput; directories are never guessed
});

const read = diagnoseRegistry({
  mode: 'read-proof',
  proof: scanned.conclusion,
  expectedProviderId: 'agent-method-registry',
});
```

`professional-scan` sets `conclusion.outcome.code` to `REGISTRY_CLEAR`, `REGISTRY_FINDINGS`, `REGISTRY_CHECK_INCOMPLETE`, or `REGISTRY_CHECK_UNAVAILABLE` (`ok: true` with unverified checks yields `REGISTRY_CHECK_INCOMPLETE`). `read-proof` inspects an in-memory proof object without reading files or re-running scans, returning `status: "pass" | "not_pass" | "unavailable"`.

## CLI

```bash
# Read-only command overview and supported host list
agent-method-registry --help

# Validate catalogs and project overlays
agent-method-registry validate --catalog catalog.yaml --project agent-methods.yaml

# Build and query an effective index
agent-method-registry index --catalog catalog.yaml --project agent-methods.yaml --out index.json
agent-method-registry query --index index.json --domain zh-CN --intent rewrite

# Resolve a method entry for a target host (codex, claude-code, antigravity, kimi, qoder, codebuddy, workbuddy, grok, cursor, deepseek-harness/dsh)
agent-method-registry resolve --index index.json --ref humanize-rewrite \
  --host antigravity --plugin-root /absolute/plugin/path

# Safely unbind a project override or v2 binding (validates remaining config, cleans dangling refs, idempotent)
agent-method-registry unbind humanize-rewrite --project agent-methods.yaml --catalog catalog.yaml

# Preview v1-to-v2 migration (review mappings and collisions before --apply)
agent-method-registry migrate --catalog catalog.yaml --project agent-methods.yaml \
  --migration-context migration-context.json --dry-run --out-plan migration-plan.json --transaction-root .

# Run professional scan with exclusive proof creation, then read the proof
agent-method-registry diagnose --mode professional-scan \
  --input-root . --input diagnose-request.json --subject my-registry \
  --conclusion-output /absolute/path/conclusion.json
agent-method-registry diagnose --mode read-proof --proof-root . --proof conclusion.json
```

Every CLI invocation writes a single-line JSON envelope `{ "ok": boolean, "data": ..., "diagnostics": [...] }` to stdout. Exit codes: `0` = success (including empty query matches and idempotent `unbind` when already unbound), `1` = validation/verification/drift failure or `not_pass` proof, `2` = CLI usage error or unreadable/foreign proof.

## Safety

<!-- release-skill:capability:safe-first-command -->
A safe first command is `agent-method-registry --help`: it is read-only, exits `0`, and writes nothing. `validate`, `query`, `resolve`, and `diagnose` (without `--conclusion-output`) only read the files explicitly named on the command line and never execute cataloged skills.

<!-- release-skill:capability:external-write-boundary -->
External-write boundary: this package is deterministic and purely local. It makes no network calls and performs no remote writes. Local disk writes happen only when explicitly requested: `index --out`, `unbind` (without `--dry-run`, updating the target project config or removing an emptied v2 binding file), `diagnose --conclusion-output` (exclusive new file creation, never overwriting), and `migrate` confined to `--transaction-root`.

## License

[Apache-2.0](LICENSE)

See [NOTICE](NOTICE) for attribution.
