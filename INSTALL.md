# Installation

## Requirements

- Node.js `>=22.0.0`

## npm

```bash
npm install agent-method-registry
```

## pnpm

```bash
pnpm add agent-method-registry
```

## CLI Usage

After installation, the CLI is available as `agent-method-registry`:

```bash
npx agent-method-registry validate --catalog catalog.yaml
npx agent-method-registry query --index index.json
```

## Programmatic Usage

```javascript
import { validateCatalog, buildEffectiveIndex, queryEffectiveIndex } from 'agent-method-registry';

// Validate a catalog
const result = validateCatalog(catalogData);
if (!result.ok) {
  console.error(result.diagnostics);
}

// Build effective index
const index = buildEffectiveIndex({ catalogs: [catalogData] });
if (index.ok) {
  // Query
  const query = queryEffectiveIndex({ index: index.index, domain: 'artifact' });
}
```
