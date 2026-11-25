# Installation & Project Setup

## Requirements

- Node.js `>=22.0.0`

## Install via npm or pnpm

```bash
npm install agent-method-registry
# or
pnpm add agent-method-registry
```

## Quick CLI verification

Verify the installed binary without modifying any project files:

```bash
npx agent-method-registry --help
npx agent-method-registry validate --catalog catalog.yaml
npx agent-method-registry query --index index.json
```

### Supported host identifiers

`resolve`, `verifyProvider`, `buildEffectiveIndex`, and `diagnoseRegistry` share a unified host registry:

- `codex`
- `claude-code` (compatible with `claude` alias)
- `antigravity` (compatible with `antigravity-ide` and `agy` CLI aliases; supports `.agents/skills`, `.agent/skills`, `~/.gemini/config/skills`, and `~/.gemini/config/plugins/*/skills`)
- `kimi` (compatible with `kimi-code` host profiles)
- `qoder`
- `codebuddy`
- `workbuddy`
- `grok`
- `cursor`
- `deepseek-harness` (compatible with `dsh` alias)

## Managing project overrides and safe unbinding

In v1 projects, `agent-methods.yaml` lets a repository override a catalog entry with a project-local skill or disable specific entries without editing upstream plugin catalogs. When retiring an override or project-local entry, run `unbind` to remove it cleanly and verify that the remaining configuration has no schema errors or dangling references:

```bash
# Preview changes without modifying disk
npx agent-method-registry unbind humanize-rewrite --project agent-methods.yaml --catalog catalog.yaml --dry-run

# Apply unbind (idempotent: exits 0 with an info diagnostic if already unbound)
npx agent-method-registry unbind humanize-rewrite --project agent-methods.yaml --catalog catalog.yaml
```

`unbind` also supports v2 `v2-binding` files: it removes matching `serviceBindings` or family `bindings`, refuses partial service removal inside an atomic family binding (`BINDING_INVALID`), and cleans up the binding file when its final binding is removed.

## Adopting the v2 skill-family SPI (available since 0.2.0)

Installing a skill-family package adds an inventory candidate; it does not implicitly enable or bind the implementation. To adopt a v2 family in a project:

1. Validate the compiled Family API and implementation descriptor (`validateCatalog`).
2. Normalize discovered host installations and compute the capability projection (`buildEffectiveIndex` with non-empty `inventoryEntries`).
3. Create an explicit `v2-binding` document (`validateProjectOverlay`) when enabling a family or `mixSafe` service.
4. Run `queryEffectiveIndex` with `purpose: 'recommendation'` for read-only discovery (`executable` flag) or `purpose: 'prepare'` with a content-bound `projectFactsEvidence` envelope to obtain a process-local `preparedQueryHandle`.
5. Pass `preparedQueryHandle` and exact `serviceIdentity` to `resolveEntry` to mint a 16-field `runMethodLock`, then re-verify the filesystem via `verifyProvider` immediately before execution.

For v1-to-v2 migration, always generate and inspect a dry-run plan before applying:

```bash
npx agent-method-registry migrate \
  --catalog agent-methods/catalog.yaml \
  --project agent-methods/project.yaml \
  --migration-context agent-methods/migration-context.json \
  --dry-run \
  --out-plan agent-methods/migration-plan.json \
  --transaction-root .
```

Rollback requires an untampered snapshot and byte-identical target files; any post-apply manual edit aborts rollback before touching disk.

## Professional diagnosis and proof reading

```bash
npx agent-method-registry diagnose --mode professional-scan \
  --input-root . --input diagnose-request.json --subject my-registry \
  --conclusion-output /absolute/path/conclusion.json

npx agent-method-registry diagnose --mode read-proof \
  --proof-root . --proof conclusion.json
```

`professional-scan` evaluates only the explicit `DiagnoseInput` JSON file and creates `--conclusion-output` exclusively (never overwriting existing proofs). `read-proof` validates and interprets the saved conclusion without re-scanning.

## Subpath exports

```text
agent-method-registry/schemas/catalog.schema.json
agent-method-registry/schemas/project.schema.json
agent-method-registry/schemas/implementation.schema.json
agent-method-registry/schemas/inventory.schema.json
agent-method-registry/schemas/binding.schema.json
agent-method-registry/schemas/projection.schema.json
agent-method-registry/schemas/run-lock.schema.json
agent-method-registry/protocol/canonical-json-v1
```
