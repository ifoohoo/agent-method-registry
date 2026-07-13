# agent-method-registry

[中文](README.zh-CN.md)

Deterministic registry for agent method catalog resolution, provider verification, and CLI
diagnostics.

`agent-method-registry` helps agentic coding projects maintain a canonical catalog of methods
(skills/workflows), resolve providers with filesystem verification, and diagnose registry health.
It is designed for deterministic local use with CLI tools, Node libraries, and CI pipelines.

## Install

```bash
npm install agent-method-registry
```

Node.js `>=22.0.0` is required.

## Quick Start

```javascript
import {
  validateCatalog,
  validateProjectOverlay,
  buildEffectiveIndex,
  queryEffectiveIndex,
  resolveEntry,
  verifyProvider,
  diagnoseRegistry,
} from 'agent-method-registry';
```

## Public API

The package exposes exactly **7 functions** plus `ERROR_CODES` and domain types:

| Function | Purpose |
|----------|---------|
| `validateCatalog` | Validate a catalog YAML/JSON against the schema |
| `validateProjectOverlay` | Validate a project overlay (overrides, disables) |
| `buildEffectiveIndex` | Build a merged, deterministic effective index from catalogs + overlay |
| `queryEffectiveIndex` | Query the effective index with filters (domain, intent, kind) |
| `resolveEntry` | Resolve a specific entry with provider filesystem verification |
| `verifyProvider` | Verify a provider's SKILL.md exists in the filesystem |
| `diagnoseRegistry` | Run holistic registry health checks (schema, merge, freshness, provider) |

## CLI

```bash
# Validate catalog files
agent-method-registry validate --catalog catalog.yaml --project overlay.yaml

# Build effective index
agent-method-registry index --catalog catalog.yaml --out index.json

# Query the index
agent-method-registry query --index index.json
agent-method-registry query --index index.json --domain artifact --kind workflow

# Resolve a specific entry
agent-method-registry resolve --index index.json --ref my-plugin.entity.author --host claude-code --plugin-root ./plugins/my-plugin
```

All CLI commands output a single JSON envelope to stdout:

```json
{
  "ok": true,
  "data": { "..." },
  "diagnostics": []
}
```

Exit codes: `0` = success, `1` = data/index/entry error, `2` = malformed invocation.

## License

[Apache-2.0](LICENSE)

See [NOTICE](NOTICE) for attribution.
