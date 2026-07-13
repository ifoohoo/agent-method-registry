// src/validate/input.ts
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
var require2 = createRequire(import.meta.url);
var AjvConstructor = require2("ajv");
var addFormatsFn = require2("ajv-formats");
var __dirname = dirname(fileURLToPath(import.meta.url));
var SCHEMAS_DIR = (() => {
  const srcPath = resolve(__dirname, "../../schemas");
  if (existsSync(srcPath)) return srcPath;
  const distPath = resolve(__dirname, "../schemas");
  return distPath;
})();
var ajv = new AjvConstructor({ allErrors: true, strict: true });
addFormatsFn(ajv);
var schemaCache = /* @__PURE__ */ new Map();
function getValidator(schemaName) {
  const cached = schemaCache.get(schemaName);
  if (cached) return cached;
  const raw = readFileSync(resolve(SCHEMAS_DIR, `${schemaName}.schema.json`), "utf-8");
  const schema = JSON.parse(raw);
  const validator = ajv.compile(schema);
  schemaCache.set(schemaName, validator);
  return validator;
}
function validateAgainstSchema(schemaName, data, failureCode) {
  const validate = getValidator(schemaName);
  const valid = validate(data);
  if (valid) {
    return { valid: true, diagnostics: [], data };
  }
  const diagnostics = (validate.errors || []).map((err) => ({
    code: failureCode,
    severity: "error",
    message: `${err.instancePath || "/"} ${err.message || "validation failed"}`,
    source: {
      label: schemaName === "project" ? "<project>" : schemaName === "diagnostic-envelope" ? "<external>" : "<index>"
    }
  }));
  return { valid: false, diagnostics };
}

// src/schema/catalog.ts
function diag(code, message, pointer) {
  return {
    code,
    severity: "error",
    message,
    source: { label: "<index>", pointer }
  };
}
function checkSchemaVersion(data) {
  if (data.schemaVersion !== 1) {
    return diag(
      "SCHEMA_VERSION_UNSUPPORTED",
      `schemaVersion must be 1, got ${JSON.stringify(data.schemaVersion)}`
    );
  }
  return void 0;
}
function checkProviderDiscriminatedUnion(entries) {
  const diagnostics = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const provider = entry.provider;
    if (provider.scope !== "plugin") {
      diagnostics.push(
        diag(
          "INVALID_CATALOG",
          `entries[${i}].provider.scope must be "plugin", got "${provider.scope}"`,
          `/entries/${i}/provider/scope`
        )
      );
    }
  }
  return diagnostics;
}
function checkPluginMatchesCatalogId(catalogId, entries) {
  const diagnostics = [];
  for (let i = 0; i < entries.length; i++) {
    const provider = entries[i].provider;
    if (provider.scope === "plugin" && provider.plugin !== catalogId) {
      diagnostics.push(
        diag(
          "INVALID_CATALOG",
          `entries[${i}].provider.plugin "${provider.plugin}" must equal catalog.id "${catalogId}"`,
          `/entries/${i}/provider/plugin`
        )
      );
    }
  }
  return diagnostics;
}
function checkSideEffectsConflict(entries) {
  const diagnostics = [];
  for (let i = 0; i < entries.length; i++) {
    const effects = entries[i].sideEffects;
    const hasReadOnly = effects.includes("read-only");
    const hasWrite = effects.includes("write-project-artifacts") || effects.includes("external-state-change");
    if (hasReadOnly && hasWrite) {
      diagnostics.push(
        diag(
          "INVALID_CATALOG",
          `entries[${i}].sideEffects: "read-only" cannot coexist with write side effects`,
          `/entries/${i}/sideEffects`
        )
      );
    }
  }
  return diagnostics;
}
function checkRefUniqueness(entries) {
  const diagnostics = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < entries.length; i++) {
    const ref = entries[i].ref;
    if (seen.has(ref)) {
      diagnostics.push(
        diag(
          "INVALID_CATALOG",
          `entries[${i}].ref "${ref}" is duplicated`,
          `/entries/${i}/ref`
        )
      );
    }
    seen.add(ref);
  }
  return diagnostics;
}
function checkSummaryCodePoints(entries) {
  const diagnostics = [];
  for (let i = 0; i < entries.length; i++) {
    const summary = entries[i].summary;
    const len = [...summary].length;
    if (len > 160) {
      diagnostics.push(
        diag(
          "INVALID_CATALOG",
          `entries[${i}].summary exceeds 160 code points (got ${len})`,
          `/entries/${i}/summary`
        )
      );
    }
  }
  return diagnostics;
}
function checkCompactProjectionLimit(entries) {
  const diagnostics = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const projection = JSON.stringify({ ref: entry.ref, kind: entry.kind, summary: entry.summary });
    const len = [...projection].length;
    if (len > 400) {
      diagnostics.push(
        diag(
          "INVALID_CATALOG",
          `entries[${i}] compact projection exceeds 400 code points (got ${len})`,
          `/entries/${i}`
        )
      );
    }
  }
  return diagnostics;
}
function validateCatalog(data) {
  if (data != null && typeof data === "object") {
    const schemaVersionDiag = checkSchemaVersion(data);
    if (schemaVersionDiag) {
      return { ok: false, diagnostics: [schemaVersionDiag] };
    }
  }
  const schemaResult = validateAgainstSchema("catalog", data, "INVALID_CATALOG");
  if (!schemaResult.valid) {
    return { ok: false, diagnostics: schemaResult.diagnostics };
  }
  const catalogData = schemaResult.data;
  const diagnostics = [];
  diagnostics.push(...checkProviderDiscriminatedUnion(catalogData.entries));
  diagnostics.push(...checkPluginMatchesCatalogId(catalogData.catalog.id, catalogData.entries));
  diagnostics.push(...checkSideEffectsConflict(catalogData.entries));
  diagnostics.push(...checkRefUniqueness(catalogData.entries));
  diagnostics.push(...checkSummaryCodePoints(catalogData.entries));
  diagnostics.push(...checkCompactProjectionLimit(catalogData.entries));
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, data: catalogData, diagnostics: [] };
}

// src/schema/project.ts
function diag2(code, message, pointer) {
  return {
    code,
    severity: "error",
    message,
    source: { label: "<project>", pointer }
  };
}
function checkSchemaVersion2(data) {
  if (data.schemaVersion !== 1) {
    return diag2(
      "SCHEMA_VERSION_UNSUPPORTED",
      `schemaVersion must be 1, got ${JSON.stringify(data.schemaVersion)}`
    );
  }
  return void 0;
}
function checkProjectEntryProviders(entries) {
  const diagnostics = [];
  for (let i = 0; i < entries.length; i++) {
    const provider = entries[i].provider;
    if (provider.scope !== "project") {
      diagnostics.push(
        diag2(
          "INVALID_PROJECT_OVERLAY",
          `entries[${i}].provider.scope must be "project", got "${provider.scope}"`,
          `/entries/${i}/provider/scope`
        )
      );
    }
    if ("plugin" in provider) {
      diagnostics.push(
        diag2(
          "INVALID_PROJECT_OVERLAY",
          `entries[${i}].provider must not have "plugin" field for project scope`,
          `/entries/${i}/provider`
        )
      );
    }
  }
  return diagnostics;
}
function checkOverrideProviders(overrides) {
  const diagnostics = [];
  for (const [ref, override] of Object.entries(overrides)) {
    const provider = override.provider;
    if (provider.scope !== "project") {
      diagnostics.push(
        diag2(
          "INVALID_OVERRIDE_PROVIDER",
          `overrides["${ref}"].provider.scope must be "project", got "${provider.scope}"`,
          `/overrides/${ref}/provider/scope`
        )
      );
    }
    if ("plugin" in provider) {
      diagnostics.push(
        diag2(
          "INVALID_OVERRIDE_PROVIDER",
          `overrides["${ref}"].provider must not have "plugin" field for project scope`,
          `/overrides/${ref}/provider`
        )
      );
    }
  }
  return diagnostics;
}
function checkOverrideTargets(entries, overrides) {
  const diagnostics = [];
  const projectEntryRefs = new Set(entries.map((e) => e.ref));
  for (const ref of Object.keys(overrides)) {
    if (projectEntryRefs.has(ref)) {
      diagnostics.push(
        diag2(
          "INVALID_OVERRIDE_TARGET",
          `overrides["${ref}"] targets a project entry ref; only catalog entries can be overridden`,
          `/overrides/${ref}`
        )
      );
    }
  }
  return diagnostics;
}
function validateProjectOverlay(data) {
  if (data != null && typeof data === "object") {
    const schemaVersionDiag = checkSchemaVersion2(data);
    if (schemaVersionDiag) {
      return { ok: false, diagnostics: [schemaVersionDiag] };
    }
  }
  const schemaResult = validateAgainstSchema("project", data, "INVALID_PROJECT_OVERLAY");
  if (!schemaResult.valid) {
    return { ok: false, diagnostics: schemaResult.diagnostics };
  }
  const overlayData = schemaResult.data;
  const diagnostics = [];
  if (overlayData.entries) {
    diagnostics.push(...checkProjectEntryProviders(overlayData.entries));
  }
  if (overlayData.overrides) {
    diagnostics.push(...checkOverrideProviders(overlayData.overrides));
    if (overlayData.entries) {
      diagnostics.push(...checkOverrideTargets(overlayData.entries, overlayData.overrides));
    }
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, data: overlayData, diagnostics: [] };
}

// src/canonicalize/content-hash.ts
import { createHash } from "crypto";

// src/canonicalize/entry.ts
function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const canonicalized = value.map(canonicalizeJson);
    return canonicalized.sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return 0;
    });
  }
  const obj = value;
  const sortedKeys = Object.keys(obj).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalizeJson(obj[key]);
  }
  return result;
}
function canonicalStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}

// src/canonicalize/content-hash.ts
function computeContentHash(data) {
  const canonical = canonicalStringify(data);
  const hash = createHash("sha256").update(canonical).digest("hex");
  return `sha256:${hash}`;
}

// src/resolver/merge.ts
function mergeCatalogs(catalogs) {
  const entries = /* @__PURE__ */ new Map();
  const sourceMap = /* @__PURE__ */ new Map();
  const diagnostics = [];
  const idSet = /* @__PURE__ */ new Map();
  for (let i = 0; i < catalogs.length; i++) {
    const id = catalogs[i].catalog.id;
    const prev = idSet.get(id);
    if (prev !== void 0) {
      diagnostics.push({
        code: "DUPLICATE_CATALOG_ID",
        severity: "error",
        message: `Duplicate catalog.id "${id}" at index ${i} (first seen at index ${prev})`,
        source: { label: `<catalog:${id}>` }
      });
    }
    idSet.set(id, i);
  }
  if (diagnostics.length > 0) {
    return { entries, sourceMap, diagnostics };
  }
  for (const catalog of catalogs) {
    const sourceLabel = `<catalog:${catalog.catalog.id}>`;
    for (const entry of catalog.entries) {
      const existing = entries.get(entry.ref);
      if (existing) {
        diagnostics.push({
          code: "DUPLICATE_DEFAULT_PROVIDER",
          severity: "error",
          message: `Duplicate default provider for ref "${entry.ref}" in catalog "${catalog.catalog.id}"; first defined in "${sourceMap.get(entry.ref)}"`,
          source: { label: sourceLabel }
        });
      } else {
        entries.set(entry.ref, entry);
        sourceMap.set(entry.ref, catalog.catalog.id);
      }
    }
  }
  return { entries, sourceMap, diagnostics };
}

// src/resolver/overlay.ts
function applyOverlay(merged, sourceMap, overlay) {
  const entries = new Map(merged);
  const disabledEntries = [];
  const diagnostics = [];
  const projectEntries = overlay.entries ?? [];
  const overrides = overlay.overrides ?? {};
  const disabled = overlay.disabled ?? [];
  for (const entry of projectEntries) {
    if (merged.has(entry.ref)) {
      diagnostics.push({
        code: "DUPLICATE_PROJECT_ENTRY",
        severity: "error",
        message: `Project entry ref "${entry.ref}" duplicates an existing catalog ref; use "overrides" instead`,
        source: { label: "<project>" }
      });
    } else {
      entries.set(entry.ref, entry);
      sourceMap.set(entry.ref, "project");
    }
  }
  if (diagnostics.length > 0) {
    return { entries, disabledEntries, diagnostics };
  }
  for (const [ref, override] of Object.entries(overrides)) {
    if (!merged.has(ref)) {
      if (entries.has(ref)) {
        diagnostics.push({
          code: "INVALID_OVERRIDE_TARGET",
          severity: "error",
          message: `Override for "${ref}" targets a project entry; project entries cannot be overridden`,
          source: { label: "<project>" }
        });
      } else {
        diagnostics.push({
          code: "UNKNOWN_OVERRIDE_REF",
          severity: "error",
          message: `Override targets non-existent ref "${ref}"`,
          source: { label: "<project>" }
        });
      }
    } else {
      const provider = override.provider;
      if (provider.scope !== "project") {
        diagnostics.push({
          code: "INVALID_OVERRIDE_PROVIDER",
          severity: "error",
          message: `Override for "${ref}" provider must have scope "project", got "${provider.scope}"`,
          source: { label: "<project>" }
        });
      } else if ("plugin" in provider) {
        diagnostics.push({
          code: "INVALID_OVERRIDE_PROVIDER",
          severity: "error",
          message: `Override for "${ref}" provider must not have "plugin" field for project scope`,
          source: { label: "<project>" }
        });
      } else {
        const existing = entries.get(ref);
        entries.set(ref, { ...existing, provider });
      }
    }
  }
  if (diagnostics.length > 0) {
    return { entries, disabledEntries, diagnostics };
  }
  for (const ref of disabled) {
    const entry = entries.get(ref);
    if (!entry) {
      diagnostics.push({
        code: "UNKNOWN_DISABLED_REF",
        severity: "error",
        message: `Disabled targets non-existent ref "${ref}"`,
        source: { label: "<project>" }
      });
    } else {
      const sourceCatalog = sourceMap.get(ref) ?? "project";
      disabledEntries.push({
        ref,
        provider: { ...entry.provider },
        sourceCatalog,
        disabledBy: "agent-methods.yaml"
      });
      entries.delete(ref);
    }
  }
  return { entries, disabledEntries, diagnostics };
}

// src/resolver/index.ts
function buildEffectiveIndex(input) {
  const allDiagnostics = [];
  const validatedCatalogs = [];
  for (let i = 0; i < input.catalogs.length; i++) {
    const result = validateCatalog(input.catalogs[i]);
    if (!result.ok) {
      allDiagnostics.push(...result.diagnostics);
    } else {
      validatedCatalogs.push(result.data);
    }
  }
  if (allDiagnostics.length > 0) {
    return { ok: false, diagnostics: allDiagnostics };
  }
  const mergeResult = mergeCatalogs(validatedCatalogs);
  if (mergeResult.diagnostics.length > 0) {
    return { ok: false, diagnostics: mergeResult.diagnostics };
  }
  let overlayResult = null;
  let projectData;
  if (input.project !== void 0) {
    const result = validateProjectOverlay(input.project);
    if (!result.ok) {
      return { ok: false, diagnostics: result.diagnostics };
    }
    projectData = result.data;
    overlayResult = applyOverlay(mergeResult.entries, mergeResult.sourceMap, projectData);
    if (overlayResult.diagnostics.length > 0) {
      return { ok: false, diagnostics: overlayResult.diagnostics };
    }
  }
  const finalEntries = overlayResult?.entries ?? mergeResult.entries;
  const sortedEntries = [...finalEntries.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([ref, entry]) => {
    const sourceCatalog = mergeResult.sourceMap.get(ref) ?? "project";
    const provenance = { sourceCatalog };
    if (overlayResult && projectData?.overrides?.[ref]) {
      provenance.overriddenBy = "agent-methods.yaml";
    }
    return { ...entry, provenance };
  });
  const sortedDisabled = (overlayResult?.disabledEntries ?? []).sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
  const catalogInputs = validatedCatalogs.map((c) => ({
    id: c.catalog.id,
    version: c.catalog.version,
    contentHash: computeContentHash(c)
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const index = {
    schemaVersion: 1,
    inputs: {
      catalogs: catalogInputs,
      projectContentHash: projectData ? computeContentHash(projectData) : computeContentHash(null)
    },
    entries: sortedEntries,
    disabledEntries: sortedDisabled
  };
  return { ok: true, index, diagnostics: [] };
}

// src/schema/effective.ts
function validateEffectiveIndex(data) {
  const result = validateAgainstSchema("effective-index", data, "INVALID_EFFECTIVE_INDEX");
  if (!result.valid) {
    return { ok: false, diagnostics: result.diagnostics };
  }
  return { ok: true, data: result.data, diagnostics: [] };
}

// src/query/engine.ts
var DEFAULT_LIMIT = 8;
var VALID_FORMATS = /* @__PURE__ */ new Set(["compact", "full"]);
function queryEffectiveIndex(input) {
  const diagnostics = [];
  const indexValidation = validateEffectiveIndex(input.index);
  if (!indexValidation.ok) {
    return { ok: false, diagnostics: indexValidation.diagnostics };
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (input.limit !== void 0) {
    if (!Number.isInteger(limit) || limit <= 0) {
      return {
        ok: false,
        diagnostics: [{
          code: "INVALID_QUERY",
          severity: "error",
          message: `Invalid limit: must be a positive integer, got ${input.limit}`
        }]
      };
    }
  }
  const format = input.format ?? "compact";
  if (input.format !== void 0 && !VALID_FORMATS.has(input.format)) {
    return {
      ok: false,
      diagnostics: [{
        code: "INVALID_QUERY",
        severity: "error",
        message: `Invalid format: must be 'compact' or 'full', got '${input.format}'`
      }]
    };
  }
  let filtered = input.index.entries;
  if (input.domain !== void 0) {
    filtered = filtered.filter((e) => e.match.domains.includes(input.domain));
  }
  if (input.artifactType !== void 0) {
    filtered = filtered.filter((e) => e.match.artifactTypes.includes(input.artifactType));
  }
  if (input.intent !== void 0) {
    filtered = filtered.filter((e) => e.match.intents.includes(input.intent));
  }
  if (input.kind !== void 0) {
    filtered = filtered.filter((e) => e.kind === input.kind);
  }
  const limited = filtered.slice(0, limit);
  if (limited.length === 0) {
    diagnostics.push({
      code: "NO_QUERY_MATCH",
      severity: "info",
      message: "No entries matched the query filters"
    });
  }
  if (format === "compact") {
    const entries = limited.map((e) => ({
      ref: e.ref,
      kind: e.kind,
      summary: e.summary
    }));
    return { ok: true, data: { entries }, diagnostics };
  }
  return { ok: true, data: { entries: limited }, diagnostics };
}

// src/provider/verify.ts
import { existsSync as existsSync2, realpathSync } from "fs";
import { join } from "path";
function diag3(code, message) {
  return {
    code,
    severity: "error",
    message,
    source: { label: "<external>" }
  };
}
function checkSkillMd(dir, skill) {
  const skillPath = join(dir, skill, "SKILL.md");
  return existsSync2(skillPath);
}
function resolveCanonical(dir, skill) {
  const skillPath = join(dir, skill, "SKILL.md");
  return realpathSync(skillPath);
}
function verifyProvider(input) {
  const { host, pluginRoots, projectRoots, provider } = input;
  const hasRoots = pluginRoots && Object.keys(pluginRoots).length > 0 || projectRoots && projectRoots.length > 0;
  if (hasRoots && !host) {
    return {
      status: "not-found",
      diagnostics: [diag3("HOST_REQUIRED", "host is required when roots are provided")]
    };
  }
  let dirs;
  if (provider.scope === "plugin") {
    const pluginProvider = provider;
    const roots = pluginRoots?.[pluginProvider.plugin];
    if (!roots || roots.length === 0) {
      return { status: "unverified", diagnostics: [] };
    }
    dirs = roots;
  } else {
    if (!projectRoots || projectRoots.length === 0) {
      return { status: "unverified", diagnostics: [] };
    }
    dirs = projectRoots;
  }
  const canonicalPaths = /* @__PURE__ */ new Set();
  for (const dir of dirs) {
    if (checkSkillMd(dir, provider.skill)) {
      try {
        const canonical = resolveCanonical(dir, provider.skill);
        canonicalPaths.add(canonical);
      } catch {
        const fallback = join(dir, provider.skill, "SKILL.md");
        canonicalPaths.add(fallback);
      }
    }
  }
  if (canonicalPaths.size === 0) {
    return {
      status: "not-found",
      diagnostics: [
        diag3(
          "PROVIDER_NOT_FOUND",
          `SKILL.md not found for skill "${provider.skill}" in any root`
        )
      ]
    };
  }
  if (canonicalPaths.size === 1) {
    return { status: "verified", diagnostics: [] };
  }
  return {
    status: "ambiguous",
    diagnostics: [
      diag3(
        "AMBIGUOUS_PROVIDER",
        `Multiple SKILL.md files found for skill "${provider.skill}" across roots`
      )
    ]
  };
}

// src/provider/resolve.ts
function resolveEntry(input) {
  const { index, ref, host, pluginRoots, projectRoots, strictProvider } = input;
  const hasRoots = pluginRoots && Object.keys(pluginRoots).length > 0 || projectRoots && projectRoots.length > 0;
  const needsHost = hasRoots || strictProvider;
  if (needsHost && !host) {
    return {
      ok: false,
      diagnostics: [
        diag3(
          "HOST_REQUIRED",
          "host is required when roots or strictProvider are provided"
        )
      ]
    };
  }
  const validationResult = validateEffectiveIndex(index);
  if (!validationResult.ok) {
    return {
      ok: false,
      diagnostics: validationResult.diagnostics
    };
  }
  const disabled = index.disabledEntries.find((e) => e.ref === ref);
  if (disabled) {
    return {
      ok: false,
      diagnostics: [
        diag3(
          "ENTRY_DISABLED",
          `Entry "${ref}" is disabled by ${disabled.disabledBy}`
        )
      ]
    };
  }
  const entry = index.entries.find((e) => e.ref === ref);
  if (!entry) {
    return {
      ok: false,
      diagnostics: [
        diag3("ENTRY_NOT_FOUND", `Entry "${ref}" not found in effective index`)
      ]
    };
  }
  if (!host) {
    return { ok: true, data: { entry }, diagnostics: [] };
  }
  if (!hasRoots && !strictProvider) {
    return { ok: true, data: { entry }, diagnostics: [] };
  }
  const verificationResult = verifyProvider({
    host,
    pluginRoots,
    projectRoots,
    provider: entry.provider
  });
  const verification = {
    status: verificationResult.status,
    diagnostics: verificationResult.diagnostics
  };
  if (verificationResult.status === "not-found" && hasRoots) {
    return {
      ok: false,
      diagnostics: verificationResult.diagnostics
    };
  }
  if (verificationResult.status === "ambiguous" && hasRoots) {
    return {
      ok: false,
      diagnostics: verificationResult.diagnostics
    };
  }
  if (strictProvider && verificationResult.status === "unverified") {
    return {
      ok: false,
      diagnostics: [
        diag3(
          "PROVIDER_UNVERIFIED",
          `Provider for "${ref}" could not be verified; roots not available for plugin "${entry.provider.scope === "plugin" ? entry.provider.plugin : "project"}"`
        )
      ]
    };
  }
  return { ok: true, data: { entry, verification }, diagnostics: [] };
}

export {
  validateCatalog,
  validateProjectOverlay,
  computeContentHash,
  buildEffectiveIndex,
  validateEffectiveIndex,
  queryEffectiveIndex,
  verifyProvider,
  resolveEntry
};
