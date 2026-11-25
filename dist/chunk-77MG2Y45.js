import {
  REGISTRY_PROVIDER_ID,
  SUPPORTED_HOST_LIST,
  applyMigrationPlan,
  buildEffectiveIndex,
  computeContentHash,
  diagnoseRegistry,
  discoverDefaultAntigravityRoots,
  formatSupportedHosts,
  generateMigrationPlan,
  isSupportedHost,
  normalizeHostId,
  queryEffectiveIndex,
  resolveEntry,
  rollbackMigration,
  validateCatalog,
  validateEffectiveIndex,
  validateProjectOverlay,
  validateServiceIdFamily,
  validateTransactionPath
} from "./chunk-B2A5J4XP.js";

// src/cli.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, existsSync as existsSync2, mkdirSync } from "fs";
import { parse as yamlParse2 } from "yaml";
import { resolve as resolve2, dirname as dirname2, relative as relative2, isAbsolute as isAbsolute2, basename as basename2 } from "path";
import { readFileStrict, publishFileExclusive } from "skill-family-harness-node";

// src/unbind.ts
import { existsSync, lstatSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
var DEFAULT_CONFIG_CANDIDATES = [
  "agent-methods.yaml",
  "agent-methods.yml",
  "agent-methods.json"
];
function resolveTargetConfigPath(options) {
  if (options.projectPath) {
    if (options.projectPath.includes("\0") || options.projectPath.split(/[\\/]+/).includes("..")) {
      return {
        ok: false,
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Unsafe project configuration path rejected (contains ".." or null byte): "${options.projectPath}"`,
          source: { label: "<project>" },
          suggestion: "Pass a clean path without .. traversal segments."
        }]
      };
    }
    const absPath = resolve(options.projectPath);
    const parent = dirname(absPath);
    if (!existsSync(parent)) {
      return {
        ok: false,
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Cannot access project configuration directory "${parent}" for "${options.projectPath}"`,
          source: { label: "<project>" },
          suggestion: "Verify that the parent project directory exists before running unbind."
        }]
      };
    }
    const pathCheck = validateTransactionPath(basename(absPath), parent);
    if (!pathCheck.ok) {
      return {
        ok: false,
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Unsafe project configuration path rejected (${pathCheck.reason}): "${options.projectPath}"`,
          source: { label: "<project>" },
          suggestion: "Use a direct regular file inside the project directory rather than a symlink."
        }]
      };
    }
    if (existsSync(absPath)) {
      return { ok: true, path: absPath, exists: true };
    }
    return { ok: true, path: absPath, exists: false };
  }
  const rootDir = resolve(options.projectRoot);
  if (!existsSync(rootDir) || lstatSync(rootDir).isSymbolicLink()) {
    return {
      ok: false,
      diagnostics: [{
        code: "INPUT_READ_FAILED",
        severity: "error",
        message: !existsSync(rootDir) ? `Project root directory does not exist: ${rootDir}` : `Project root directory must not be a symlink: ${rootDir}`,
        source: { label: "<project>" },
        suggestion: "Pass an existing non-symlink directory to --project-root or specify --project <file>."
      }]
    };
  }
  for (const candidate of DEFAULT_CONFIG_CANDIDATES) {
    const candidatePath = join(rootDir, candidate);
    if (existsSync(candidatePath)) {
      const candidateCheck = validateTransactionPath(candidate, rootDir);
      if (!candidateCheck.ok || !lstatSync(candidatePath).isFile()) {
        return {
          ok: false,
          diagnostics: [{
            code: "INPUT_READ_FAILED",
            severity: "error",
            message: `Unsafe project configuration file rejected (${candidateCheck.reason ?? "not a regular file"}): ${candidatePath}`,
            source: { label: "<project>" },
            suggestion: "Ensure agent-methods config is a regular file contained in the project root."
          }]
        };
      }
      return { ok: true, path: candidatePath, exists: true };
    }
  }
  return { ok: true, path: join(rootDir, DEFAULT_CONFIG_CANDIDATES[0]), exists: false };
}
function serializeConfig(filePath, data) {
  const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");
  if (isYaml) {
    return yamlStringify(data);
  }
  return JSON.stringify(data, null, 2) + "\n";
}
function collectCatalogRefs(catalogs) {
  if (!catalogs || catalogs.length === 0) return void 0;
  const refs = /* @__PURE__ */ new Set();
  for (const cat of catalogs) {
    if (cat && typeof cat === "object" && Array.isArray(cat.entries)) {
      for (const entry of cat.entries) {
        if (typeof entry?.ref === "string") refs.add(entry.ref);
      }
    }
  }
  return refs;
}
function matchesFamilyBinding(binding, methodId) {
  return binding.familyId === methodId || binding.apiIdentity.apiId === methodId || binding.implementationIdentity.familyImplementationId === methodId;
}
function matchesServiceBinding(binding, methodId) {
  return binding.serviceId === methodId || binding.familyId === methodId || binding.apiIdentity.apiId === methodId || binding.implementationIdentity.familyImplementationId === methodId;
}
function unbindProjectMethod(options) {
  const { methodId, catalogs, includeDisabled = false, dryRun = false } = options;
  const resolved = resolveTargetConfigPath(options);
  if (!resolved.ok) return resolved;
  if (!resolved.exists) {
    return {
      ok: true,
      data: {
        methodId,
        projectPath: resolved.path,
        protocol: "none",
        status: "not-bound",
        changed: false,
        removedFrom: [],
        fileRemoved: false,
        dryRun,
        remainingValid: true
      },
      diagnostics: [{
        code: "NO_QUERY_MATCH",
        severity: "info",
        message: `Method "${methodId}" is not bound because project configuration "${resolved.path}" does not exist.`,
        source: { label: "<project>" }
      }]
    };
  }
  let parsedRaw;
  try {
    const rawText = readFileSync(resolved.path, "utf-8");
    const isYaml = resolved.path.endsWith(".yaml") || resolved.path.endsWith(".yml");
    parsedRaw = isYaml ? yamlParse(rawText) : JSON.parse(rawText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [{
        code: "INPUT_READ_FAILED",
        severity: "error",
        message: `Failed to parse project configuration "${resolved.path}": ${msg}`,
        source: { label: "<project>" },
        suggestion: "Fix the YAML/JSON syntax error in the project configuration before unbinding."
      }]
    };
  }
  const initialValidation = validateProjectOverlay(parsedRaw);
  if (!initialValidation.ok) {
    return { ok: false, diagnostics: initialValidation.diagnostics };
  }
  const isV2Binding = parsedRaw !== null && typeof parsedRaw === "object" && parsedRaw.documentKind === "v2-binding";
  if (isV2Binding) {
    const doc = initialValidation.data;
    const removedFrom = [];
    const nextFamilyBindings = doc.bindings.filter((b) => !matchesFamilyBinding(b, methodId));
    const removedFamilies = doc.bindings.filter((b) => matchesFamilyBinding(b, methodId));
    if (removedFamilies.length > 0) removedFrom.push("bindings");
    const removedFamilyApiIds = new Set(removedFamilies.map((b) => b.apiIdentity.apiId));
    const currentServiceBindings = doc.serviceBindings ?? [];
    const nextServiceBindings = currentServiceBindings.filter(
      (sb) => !matchesServiceBinding(sb, methodId) && !removedFamilyApiIds.has(sb.apiIdentity.apiId)
    );
    if (nextServiceBindings.length < currentServiceBindings.length) {
      removedFrom.push("serviceBindings");
    }
    if (removedFrom.length === 0) {
      const atomicOwner = doc.bindings.find(
        (b) => validateServiceIdFamily(methodId, b.apiIdentity.apiId) === void 0
      );
      if (atomicOwner) {
        return {
          ok: false,
          diagnostics: [{
            code: "BINDING_INVALID",
            severity: "error",
            message: `Service "${methodId}" is governed by atomic family binding "${atomicOwner.apiIdentity.apiId}" (familyId: "${atomicOwner.familyId}") and cannot be unbound individually.`,
            source: { label: "<project>" },
            suggestion: `Unbind the entire family via "${atomicOwner.familyId}" or "${atomicOwner.apiIdentity.apiId}".`
          }]
        };
      }
      return {
        ok: true,
        data: {
          methodId,
          projectPath: resolved.path,
          protocol: "v2-binding",
          status: "not-bound",
          changed: false,
          removedFrom: [],
          fileRemoved: false,
          dryRun,
          remainingValid: true
        },
        diagnostics: [{
          code: "NO_QUERY_MATCH",
          severity: "info",
          message: `Method "${methodId}" has no active entry in v2 binding file "${resolved.path}".`,
          source: { label: "<project>" }
        }]
      };
    }
    if (nextFamilyBindings.length === 0 && nextServiceBindings.length === 0) {
      if (!dryRun) {
        try {
          unlinkSync(resolved.path);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            diagnostics: [{ code: "OUTPUT_WRITE_FAILED", severity: "error", message: `Failed to remove empty binding file "${resolved.path}": ${msg}` }]
          };
        }
      }
      return {
        ok: true,
        data: {
          methodId,
          projectPath: resolved.path,
          protocol: "v2-binding",
          status: "unbound",
          changed: true,
          removedFrom,
          fileRemoved: true,
          dryRun,
          remainingValid: true
        },
        diagnostics: []
      };
    }
    const nextDoc = {
      documentKind: "v2-binding",
      schemaVersion: 2,
      bindings: nextFamilyBindings,
      ...nextServiceBindings.length > 0 ? { serviceBindings: nextServiceBindings } : {}
    };
    const postValidation = validateProjectOverlay(nextDoc);
    if (!postValidation.ok) {
      return { ok: false, diagnostics: postValidation.diagnostics };
    }
    if (!dryRun) {
      try {
        writeFileSync(resolved.path, serializeConfig(resolved.path, nextDoc), "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          diagnostics: [{ code: "OUTPUT_WRITE_FAILED", severity: "error", message: `Failed to write "${resolved.path}": ${msg}` }]
        };
      }
    }
    return {
      ok: true,
      data: {
        methodId,
        projectPath: resolved.path,
        protocol: "v2-binding",
        status: "unbound",
        changed: true,
        removedFrom,
        fileRemoved: false,
        dryRun,
        remainingValid: true
      },
      diagnostics: []
    };
  }
  return unbindV1Overlay(initialValidation.data, resolved.path, {
    methodId,
    catalogs,
    includeDisabled,
    dryRun
  });
}
function unbindV1Overlay(overlay, filePath, opts) {
  const { methodId, catalogs, includeDisabled, dryRun } = opts;
  const removedFrom = [];
  const nextOverrides = overlay.overrides ? { ...overlay.overrides } : void 0;
  if (nextOverrides && Object.prototype.hasOwnProperty.call(nextOverrides, methodId)) {
    delete nextOverrides[methodId];
    removedFrom.push("overrides");
  }
  const hadProjectEntry = (overlay.entries ?? []).some((e) => e.ref === methodId);
  const nextEntries = overlay.entries ? overlay.entries.filter((e) => e.ref !== methodId) : void 0;
  if (hadProjectEntry) {
    removedFrom.push("entries");
  }
  const catalogRefs = collectCatalogRefs(catalogs);
  const shouldCleanDisabled = includeDisabled || hadProjectEntry || catalogRefs !== void 0 && !catalogRefs.has(methodId);
  let nextDisabled = overlay.disabled ? [...overlay.disabled] : void 0;
  if (nextDisabled && shouldCleanDisabled && nextDisabled.includes(methodId)) {
    nextDisabled = nextDisabled.filter((ref) => ref !== methodId);
    removedFrom.push("disabled");
  }
  const nextOverlay = {
    schemaVersion: 1,
    ...nextEntries && nextEntries.length > 0 ? { entries: nextEntries } : {},
    ...nextOverrides && Object.keys(nextOverrides).length > 0 ? { overrides: nextOverrides } : {},
    ...nextDisabled && nextDisabled.length > 0 ? { disabled: nextDisabled } : {}
  };
  const postValidation = validateProjectOverlay(nextOverlay);
  if (!postValidation.ok) {
    return { ok: false, diagnostics: postValidation.diagnostics };
  }
  if (catalogs && catalogs.length > 0) {
    const mergedCheck = buildEffectiveIndex({ catalogs, project: nextOverlay });
    if (!mergedCheck.ok) {
      return { ok: false, diagnostics: mergedCheck.diagnostics };
    }
  }
  if (removedFrom.length === 0) {
    const isStillDisabled = (overlay.disabled ?? []).includes(methodId);
    const note = isStillDisabled ? `Method "${methodId}" has no active override or project entry in "${filePath}" (currently listed in "disabled"; pass --include-disabled to also clear the disable rule).` : `Method "${methodId}" is not bound in "${filePath}".`;
    return {
      ok: true,
      data: {
        methodId,
        projectPath: filePath,
        protocol: "v1-overlay",
        status: "not-bound",
        changed: false,
        removedFrom: [],
        fileRemoved: false,
        dryRun,
        remainingValid: true
      },
      diagnostics: [{
        code: "NO_QUERY_MATCH",
        severity: "info",
        message: note,
        source: { label: "<project>" }
      }]
    };
  }
  if (!dryRun) {
    try {
      writeFileSync(filePath, serializeConfig(filePath, nextOverlay), "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        diagnostics: [{ code: "OUTPUT_WRITE_FAILED", severity: "error", message: `Failed to write "${filePath}": ${msg}` }]
      };
    }
  }
  return {
    ok: true,
    data: {
      methodId,
      projectPath: filePath,
      protocol: "v1-overlay",
      status: "unbound",
      changed: true,
      removedFrom,
      fileRemoved: false,
      dryRun,
      remainingValid: true
    },
    diagnostics: []
  };
}

// src/cli.ts
function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const flags = /* @__PURE__ */ Object.create(null);
  let command;
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      if (!Object.prototype.hasOwnProperty.call(flags, "help")) flags["help"] = [];
      flags["help"].push("");
      i += 1;
    } else if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--") && args[i + 1] !== "-h") {
        const value = args[i + 1];
        if (!Object.prototype.hasOwnProperty.call(flags, flagName)) flags[flagName] = [];
        flags[flagName].push(value);
        i += 2;
      } else {
        if (!Object.prototype.hasOwnProperty.call(flags, flagName)) flags[flagName] = [];
        flags[flagName].push("");
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  command = positional[0];
  return { command, positional, flags };
}
function hasFlag(parsed, name) {
  return Object.prototype.hasOwnProperty.call(parsed.flags, name);
}
function getFlag(parsed, name) {
  return Object.prototype.hasOwnProperty.call(parsed.flags, name) ? parsed.flags[name]?.[0] : void 0;
}
function getAllFlags(parsed, name) {
  return Object.prototype.hasOwnProperty.call(parsed.flags, name) ? parsed.flags[name] ?? [] : [];
}
var ExitError = class extends Error {
  constructor(exitCode) {
    super(`process.exit(${exitCode})`);
    this.exitCode = exitCode;
    this.name = "ExitError";
  }
  exitCode;
};
function emit(envelope, exitCode) {
  process.stdout.write(JSON.stringify(envelope) + "\n");
  process.exit(exitCode);
  throw new ExitError(exitCode);
}
function readInput(filePath) {
  let raw;
  try {
    raw = readFileSync2(filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [
        {
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to read ${filePath}: ${message}`
        }
      ]
    };
  }
  try {
    const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");
    const data = isYaml ? yamlParse2(raw) : JSON.parse(raw);
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [
        {
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to parse ${filePath}: ${message}`
        }
      ]
    };
  }
}
function writeOutput(filePath, data) {
  try {
    writeFileSync2(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      diagnostics: [
        {
          code: "OUTPUT_WRITE_FAILED",
          severity: "error",
          message: `Failed to write ${filePath}: ${message}`
        }
      ]
    };
  }
}
function usageError(message, suggestion) {
  emit(
    {
      ok: false,
      diagnostics: [{
        code: "CLI_USAGE_ERROR",
        severity: "error",
        message,
        ...suggestion ? { suggestion } : {}
      }]
    },
    2
  );
}
function requireFlag(parsed, name) {
  if (!hasFlag(parsed, name)) {
    usageError(`Missing required --${name} flag`, `Pass --${name} <value> or run with --help to inspect command options.`);
  }
  const values = getAllFlags(parsed, name);
  if (values.length > 1) {
    usageError(`Duplicate --${name} flag`, `Specify --${name} at most once.`);
  }
  if (values[0] === "") {
    usageError(`--${name} requires a value`, `Provide a non-empty value after --${name}.`);
  }
  return values[0];
}
function optionalSingleton(parsed, name) {
  if (!hasFlag(parsed, name)) return void 0;
  const values = getAllFlags(parsed, name);
  if (values.length > 1) {
    usageError(`Duplicate --${name} flag`);
  }
  if (values[0] === "") {
    usageError(`--${name} requires a value`);
  }
  return values[0];
}
var QUERY_ALLOWED_FLAGS = /* @__PURE__ */ new Set([
  "index",
  "candidate",
  "domain",
  "artifact-type",
  "intent",
  "kind",
  "limit",
  "format"
]);
var RESOLVE_ALLOWED_FLAGS = /* @__PURE__ */ new Set([
  "index",
  "ref",
  "host",
  "plugin-root",
  "project-root"
]);
function rejectUnknownFlags(parsed, allowed) {
  for (const flag of Object.keys(parsed.flags)) {
    if (!allowed.has(flag)) {
      usageError(`Unknown flag: --${flag}`);
    }
  }
}
function rejectExtraPositionals(parsed, maxPositionals) {
  if (parsed.positional.length > maxPositionals) {
    usageError(`Unexpected argument: ${parsed.positional[maxPositionals]}`);
  }
}
function requireNonEmptyRepeated(parsed, name) {
  const values = getAllFlags(parsed, name);
  for (const v of values) {
    if (v === "") {
      usageError(`--${name} requires a value`);
    }
  }
  return values;
}
function stripHashPrefix(hash) {
  const idx = hash.indexOf(":");
  return idx >= 0 ? hash.slice(idx + 1) : hash;
}
function cmdValidate(parsed) {
  const catalogPaths = requireNonEmptyRepeated(parsed, "catalog");
  if (catalogPaths.length === 0) {
    emit(
      {
        ok: false,
        diagnostics: [
          {
            code: "CLI_USAGE_ERROR",
            severity: "error",
            message: "validate requires at least one --catalog <file>"
          }
        ]
      },
      2
    );
  }
  const allDiagnostics = [];
  for (const catalogPath of catalogPaths) {
    const input = readInput(catalogPath);
    if (!input.ok) {
      allDiagnostics.push(...input.diagnostics);
      continue;
    }
    const result = validateCatalog(input.data);
    if (!result.ok) {
      allDiagnostics.push(...result.diagnostics);
    }
  }
  if (hasFlag(parsed, "project")) {
    const projectPath = getFlag(parsed, "project");
    const input = readInput(projectPath);
    if (!input.ok) {
      allDiagnostics.push(...input.diagnostics);
    } else {
      const result = validateProjectOverlay(input.data);
      if (!result.ok) {
        allDiagnostics.push(...result.diagnostics);
      }
    }
  }
  if (allDiagnostics.length > 0) {
    emit({ ok: false, diagnostics: allDiagnostics }, 1);
  }
  emit({ ok: true, data: null, diagnostics: [] }, 0);
}
function cmdIndex(parsed) {
  const catalogPaths = requireNonEmptyRepeated(parsed, "catalog");
  if (catalogPaths.length === 0) {
    emit(
      {
        ok: false,
        diagnostics: [
          {
            code: "CLI_USAGE_ERROR",
            severity: "error",
            message: "index requires at least one --catalog <file>"
          }
        ]
      },
      2
    );
  }
  const catalogDatas = [];
  const readDiagnostics = [];
  for (const catalogPath of catalogPaths) {
    const input = readInput(catalogPath);
    if (!input.ok) {
      readDiagnostics.push(...input.diagnostics);
    } else {
      catalogDatas.push(input.data);
    }
  }
  if (readDiagnostics.length > 0) {
    emit({ ok: false, diagnostics: readDiagnostics }, 1);
  }
  let projectData;
  if (hasFlag(parsed, "project")) {
    const projectPath = getFlag(parsed, "project");
    const input = readInput(projectPath);
    if (!input.ok) {
      emit({ ok: false, diagnostics: input.diagnostics }, 1);
    }
    projectData = input.ok ? input.data : void 0;
  }
  const result = buildEffectiveIndex({
    catalogs: catalogDatas,
    project: projectData
  });
  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }
  if (hasFlag(parsed, "out")) {
    const outPath = getFlag(parsed, "out");
    const writeResult = writeOutput(outPath, result.index);
    if (!writeResult.ok) {
      emit({ ok: false, diagnostics: writeResult.diagnostics }, 1);
    }
  }
  emit({ ok: true, data: result.index, diagnostics: [] }, 0);
}
var V1_FILTER_FLAGS = ["domain", "artifact-type", "intent", "kind", "limit", "format"];
function cmdQuery(parsed) {
  rejectUnknownFlags(parsed, QUERY_ALLOWED_FLAGS);
  rejectExtraPositionals(parsed, 1);
  const indexPath = requireFlag(parsed, "index");
  const candidatePath = optionalSingleton(parsed, "candidate");
  if (candidatePath !== void 0) {
    const conflicts = V1_FILTER_FLAGS.filter((f) => hasFlag(parsed, f));
    if (conflicts.length > 0) {
      usageError(
        `--candidate conflicts with v1 filter flags: ${conflicts.map((f) => `--${f}`).join(", ")}. v2 candidate queries derive intent, kind and filters from the candidate file.`
      );
    }
  }
  const domain = optionalSingleton(parsed, "domain");
  const artifactType = optionalSingleton(parsed, "artifact-type");
  const intent = optionalSingleton(parsed, "intent");
  const kindStr = optionalSingleton(parsed, "kind");
  const limitStr = optionalSingleton(parsed, "limit");
  const formatStr = optionalSingleton(parsed, "format");
  if (kindStr !== void 0 && kindStr !== "workflow" && kindStr !== "operation") {
    usageError(`Invalid --kind value: ${JSON.stringify(kindStr)}. Must be 'workflow' or 'operation'`);
  }
  const kind = kindStr;
  if (formatStr !== void 0 && formatStr !== "compact" && formatStr !== "full") {
    usageError(`Invalid --format value: ${JSON.stringify(formatStr)}. Must be 'compact' or 'full'`);
  }
  const format = formatStr;
  let limit;
  if (limitStr !== void 0) {
    const parsed_limit = Number(limitStr);
    if (!Number.isInteger(parsed_limit) || parsed_limit < 1 || parsed_limit > 8) {
      usageError(`Invalid --limit value: ${JSON.stringify(limitStr)}. Must be an integer between 1 and 8`);
    }
    limit = parsed_limit;
  }
  const input = readInput(indexPath);
  if (!input.ok) {
    emit({ ok: false, diagnostics: input.diagnostics }, 1);
  }
  let methodQueryCandidate;
  if (candidatePath !== void 0) {
    const candidateInput = readInput(candidatePath);
    if (!candidateInput.ok) emit({ ok: false, diagnostics: candidateInput.diagnostics }, 1);
    methodQueryCandidate = candidateInput.data;
  }
  const filters = {
    ...domain !== void 0 ? { domain } : {},
    ...artifactType !== void 0 ? { artifactType } : {},
    ...intent !== void 0 ? { intent } : {},
    ...kind !== void 0 ? { kind } : {},
    ...limit !== void 0 ? { limit } : {},
    ...format !== void 0 ? { format } : {}
  };
  const rawIndex = input.data;
  let result;
  if ("documentKind" in rawIndex && rawIndex.documentKind === "v2-projection") {
    result = queryEffectiveIndex({
      index: rawIndex,
      purpose: "recommendation",
      methodQueryCandidate,
      ...filters
    });
  } else {
    result = queryEffectiveIndex({ index: rawIndex, ...filters });
  }
  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }
  const hasOnlyInfoDiagnostics = result.diagnostics.every((d) => d.severity === "info");
  emit(
    { ok: true, data: result.data ?? null, diagnostics: result.diagnostics },
    hasOnlyInfoDiagnostics ? 0 : 1
  );
}
function cmdResolve(parsed) {
  rejectUnknownFlags(parsed, RESOLVE_ALLOWED_FLAGS);
  rejectExtraPositionals(parsed, 1);
  const indexPath = requireFlag(parsed, "index");
  const ref = requireFlag(parsed, "ref");
  const hostStr = requireFlag(parsed, "host");
  if (!isSupportedHost(hostStr)) {
    usageError(
      `Invalid --host value: ${JSON.stringify(hostStr)}. Must be one of ${formatSupportedHosts()}`,
      `Pass a supported host identifier such as --host codex, --host claude-code (or --host claude), --host antigravity (or --host antigravity-ide / --host agy), --host kimi (or --host kimi-code), --host qoder, --host codebuddy, --host workbuddy, --host grok, --host cursor, or --host deepseek-harness (or --host dsh).`
    );
  }
  const host = normalizeHostId(hostStr);
  const pluginRootValues = requireNonEmptyRepeated(parsed, "plugin-root");
  const projectRootValues = requireNonEmptyRepeated(parsed, "project-root");
  const input = readInput(indexPath);
  if (!input.ok) {
    emit({ ok: false, diagnostics: input.diagnostics }, 1);
  }
  const index = input.data;
  const indexValidation = validateEffectiveIndex(index);
  if (!indexValidation.ok) {
    emit({ ok: false, diagnostics: indexValidation.diagnostics }, 1);
  }
  const entry = index.entries.find((e) => e.ref === ref);
  if (!entry) {
    const disabled = index.disabledEntries?.find((e) => e.ref === ref);
    if (disabled) {
      emit({
        ok: false,
        diagnostics: [{
          code: "ENTRY_DISABLED",
          severity: "error",
          message: `Entry "${ref}" is disabled by ${disabled.disabledBy}`,
          source: { label: "<external>" }
        }]
      }, 1);
    }
    emit({
      ok: false,
      diagnostics: [{
        code: "ENTRY_NOT_FOUND",
        severity: "error",
        message: `Entry "${ref}" not found in effective index`,
        source: { label: "<external>" }
      }]
    }, 1);
  }
  let effectivePluginRoots = pluginRootValues;
  if (effectivePluginRoots.length === 0 && host === "antigravity" && entry.provider.scope === "plugin") {
    effectivePluginRoots = discoverDefaultAntigravityRoots({
      scope: "plugin",
      pluginId: entry.provider.plugin
    });
  }
  let pluginRoots;
  if (effectivePluginRoots.length > 0 && entry.provider.scope === "plugin") {
    pluginRoots = { [entry.provider.plugin]: effectivePluginRoots };
  }
  let effectiveProjectRoots = projectRootValues;
  if (effectiveProjectRoots.length === 0 && host === "antigravity" && entry.provider.scope === "project") {
    effectiveProjectRoots = discoverDefaultAntigravityRoots({ scope: "project" });
  }
  const projectRoots = effectiveProjectRoots.length > 0 ? effectiveProjectRoots : void 0;
  const result = resolveEntry({
    index,
    ref,
    host,
    ...pluginRoots !== void 0 ? { pluginRoots } : {},
    ...projectRoots !== void 0 ? { projectRoots } : {},
    strictProvider: true
  });
  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }
  const verification = {
    status: result.data.verification?.status ?? "unverified",
    host,
    diagnostics: result.data.verification?.diagnostics ?? []
  };
  const indexInputs = index.inputs;
  const catalogsHashes = {};
  for (const cat of indexInputs.catalogs) {
    catalogsHashes[cat.id] = stripHashPrefix(cat.contentHash);
  }
  const indexContentHashes = {
    catalogs: catalogsHashes,
    project: stripHashPrefix(indexInputs.projectContentHash)
  };
  emit(
    {
      ok: true,
      data: {
        entry: result.data.entry,
        verification,
        index_content_hashes: indexContentHashes
      },
      diagnostics: result.diagnostics
    },
    0
  );
}
var MIGRATE_ALLOWED_FLAGS = /* @__PURE__ */ new Set([
  "catalog",
  "project",
  "dry-run",
  "apply",
  "plan",
  "rollback",
  "snapshot",
  "out-plan",
  "out-snapshot",
  "transaction-root",
  "migration-context"
]);
function cmdMigrate(parsed) {
  rejectUnknownFlags(parsed, MIGRATE_ALLOWED_FLAGS);
  rejectExtraPositionals(parsed, 1);
  const isDryRun = hasFlag(parsed, "dry-run");
  const isApply = hasFlag(parsed, "apply");
  const isRollback = hasFlag(parsed, "rollback");
  const modeCount = [isDryRun, isApply, isRollback].filter(Boolean).length;
  if (modeCount === 0) {
    usageError("migrate requires one of: --dry-run, --apply, --rollback");
  }
  if (modeCount > 1) {
    usageError("migrate accepts only one of: --dry-run, --apply, --rollback");
  }
  const transactionRoot = optionalSingleton(parsed, "transaction-root") ? resolve2(optionalSingleton(parsed, "transaction-root")) : process.cwd();
  if (isDryRun) {
    cmdMigrateDryRun(parsed, transactionRoot);
  } else if (isApply) {
    cmdMigrateApply(parsed, transactionRoot);
  } else {
    cmdMigrateRollback(parsed, transactionRoot);
  }
}
function cmdMigrateDryRun(parsed, transactionRoot) {
  const catalogPaths = requireNonEmptyRepeated(parsed, "catalog");
  if (catalogPaths.length === 0) {
    usageError("migrate --dry-run requires at least one --catalog <file>");
  }
  const outPlanPath = optionalSingleton(parsed, "out-plan");
  const contextPath = requireFlag(parsed, "migration-context");
  const catalogDatas = [];
  const readDiags = [];
  for (const path of catalogPaths) {
    const input = readInput(path);
    if (!input.ok) {
      readDiags.push(...input.diagnostics);
    } else {
      catalogDatas.push(input.data);
    }
  }
  if (readDiags.length > 0) {
    emit({ ok: false, diagnostics: readDiags }, 1);
  }
  const v1Entries = [];
  const v1Overrides = [];
  for (const raw of catalogDatas) {
    const data = raw;
    const entries = data.entries;
    if (entries) {
      for (const entry of entries) {
        v1Entries.push({
          ref: entry.ref,
          provider: entry.provider,
          kind: entry.kind,
          summary: entry.summary
        });
      }
    }
  }
  const contextInput = readInput(contextPath);
  if (!contextInput.ok) emit({ ok: false, diagnostics: contextInput.diagnostics }, 1);
  const rawContext = contextInput.data;
  if (!rawContext || !Array.isArray(rawContext.mappings)) {
    emit({ ok: false, diagnostics: [{ code: "INVALID_MIGRATION_PLAN", severity: "error", message: "migration context requires mappings[]" }] }, 1);
  }
  if (hasFlag(parsed, "project")) {
    const projectPath = getFlag(parsed, "project");
    const input = readInput(projectPath);
    if (input.ok) {
      const overlay = input.data;
      const overrides = overlay.overrides;
      if (overrides) {
        for (const [ref, override] of Object.entries(overrides)) {
          v1Overrides.push({
            ref,
            provider: override.provider
          });
        }
      }
    }
  }
  const sourcePaths = [...catalogPaths];
  if (hasFlag(parsed, "project")) sourcePaths.push(getFlag(parsed, "project"));
  sourcePaths.push(contextPath);
  const sourceManifest = sourcePaths.map((sourcePath) => {
    const absolute = resolve2(sourcePath);
    const rel = relative2(resolve2(transactionRoot), absolute);
    if (rel.startsWith("..") || isAbsolute2(rel)) {
      emit({ ok: false, diagnostics: [{ code: "OUTPUT_WRITE_FAILED", severity: "error", message: `Migration source is outside transaction root: ${sourcePath}` }] }, 1);
    }
    return { path: rel, digest: computeContentHash(readFileSync2(absolute).toString("base64")) };
  });
  const plan = generateMigrationPlan(v1Entries, v1Overrides, {
    mappings: rawContext.mappings,
    sourceManifest
  });
  const diagnostics = [];
  if (plan.collisionReport.hasCollisions) {
    for (const collision of plan.collisionReport.collisions) {
      diagnostics.push({
        code: "COLLISION_DETECTED",
        severity: "warn",
        message: `[${collision.type}] ${collision.details}`,
        source: { label: "<project>" }
      });
    }
  }
  if (outPlanPath) {
    const resolvedPath = resolve2(transactionRoot, outPlanPath);
    const dirCheck = validateTransactionPath(outPlanPath, transactionRoot);
    if (!dirCheck.ok) {
      emit({ ok: false, diagnostics: [{ code: "OUTPUT_WRITE_FAILED", severity: "error", message: dirCheck.reason }] }, 1);
    }
    const dir = dirname2(resolvedPath);
    if (!existsSync2(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync2(resolvedPath, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  }
  emit({
    ok: true,
    data: {
      plan,
      effectiveIndexHash: computeContentHash(plan),
      collisionCount: plan.collisionReport.collisions.length
    },
    diagnostics
  }, 0);
}
function cmdMigrateApply(parsed, transactionRoot) {
  const planPath = requireFlag(parsed, "plan");
  const snapshotPath = optionalSingleton(parsed, "out-snapshot") ?? "migration-snapshot.json";
  const snapshotCheck = validateTransactionPath(snapshotPath, transactionRoot);
  if (!snapshotCheck.ok) emit({ ok: false, diagnostics: [{ code: "OUTPUT_WRITE_FAILED", severity: "error", message: snapshotCheck.reason }] }, 1);
  const planInput = readInput(planPath);
  if (!planInput.ok) {
    emit({ ok: false, diagnostics: planInput.diagnostics }, 1);
  }
  const plan = planInput.data;
  const collisionReport = plan.collisionReport;
  if (collisionReport.hasCollisions && collisionReport.collisions.length > 0) {
    emit({
      ok: false,
      diagnostics: collisionReport.collisions.map((c) => ({
        code: "COLLISION_DETECTED",
        severity: "error",
        message: `[${c.type}] ${c.details}`,
        source: { label: "<project>" }
      }))
    }, 1);
  }
  const result = applyMigrationPlan(
    plan,
    transactionRoot,
    (/* @__PURE__ */ new Date()).toISOString()
  );
  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }
  const resolvedSnapshot = resolve2(transactionRoot, snapshotPath);
  const snapDir = dirname2(resolvedSnapshot);
  if (!existsSync2(snapDir)) {
    mkdirSync(snapDir, { recursive: true });
  }
  writeFileSync2(resolvedSnapshot, JSON.stringify(result.snapshot, null, 2) + "\n", "utf-8");
  emit({
    ok: true,
    data: {
      snapshot: result.snapshot,
      appliedFiles: Object.keys(plan.targetFiles),
      snapshotPath: resolvedSnapshot
    },
    diagnostics: []
  }, 0);
}
var DIAGNOSE_ALLOWED_FLAGS = /* @__PURE__ */ new Set([
  "mode",
  "input-root",
  "input",
  "subject",
  "conclusion-output",
  "proof-root",
  "proof"
]);
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
function harnessKind(err) {
  if (typeof err !== "object" || err === null) return void 0;
  const details = err.details;
  return typeof details?.kind === "string" ? details.kind : void 0;
}
async function cmdDiagnose(parsed) {
  rejectUnknownFlags(parsed, DIAGNOSE_ALLOWED_FLAGS);
  rejectExtraPositionals(parsed, 1);
  const mode = requireFlag(parsed, "mode");
  if (mode !== "professional-scan" && mode !== "read-proof") {
    usageError(`Unknown diagnose mode: ${JSON.stringify(mode)}. Must be 'professional-scan' or 'read-proof'`);
  }
  if (mode === "professional-scan") {
    await cmdDiagnoseScan(parsed);
    return;
  }
  await cmdDiagnoseReadProof(parsed);
}
async function cmdDiagnoseScan(parsed) {
  const inputRoot = requireFlag(parsed, "input-root");
  const inputRel = requireFlag(parsed, "input");
  const subjectRef = requireFlag(parsed, "subject");
  const conclusionOutput = optionalSingleton(parsed, "conclusion-output");
  if (hasFlag(parsed, "proof-root") || hasFlag(parsed, "proof")) {
    usageError("professional-scan does not accept --proof-root or --proof");
  }
  if (conclusionOutput !== void 0 && !isAbsolute2(conclusionOutput)) {
    usageError("--conclusion-output requires an absolute path");
  }
  let content;
  try {
    const receipt = await readFileStrict(inputRoot, inputRel, { encoding: "utf8" });
    content = String(receipt.content);
  } catch (err) {
    emit(
      {
        ok: false,
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to read diagnose input: ${errorMessage(err)}`
        }]
      },
      2
    );
  }
  let request;
  try {
    request = JSON.parse(content);
  } catch (err) {
    emit(
      {
        ok: false,
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to parse diagnose input JSON: ${errorMessage(err)}`
        }]
      },
      1
    );
  }
  let result;
  try {
    result = diagnoseRegistry({
      mode: "professional-scan",
      subject: { ref: subjectRef },
      request
    });
  } catch (err) {
    emit(
      {
        ok: false,
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to diagnose registry: ${errorMessage(err)}`
        }]
      },
      1
    );
  }
  if (conclusionOutput !== void 0) {
    try {
      await publishFileExclusive(
        dirname2(conclusionOutput),
        basename2(conclusionOutput),
        JSON.stringify(result.conclusion, null, 2) + "\n"
      );
    } catch (err) {
      emit(
        {
          ok: false,
          diagnostics: [{
            code: "OUTPUT_WRITE_FAILED",
            severity: "error",
            message: harnessKind(err) === "exclusive-publish-conflict" ? `Conclusion output already exists: ${conclusionOutput}` : `Failed to write conclusion: ${errorMessage(err)}`
          }]
        },
        1
      );
    }
  }
  const exitCode = result.conclusion.outcome.code === "REGISTRY_CLEAR" ? 0 : 1;
  emit(
    {
      ok: exitCode === 0,
      data: result,
      diagnostics: result.diagnostics
    },
    exitCode
  );
}
async function cmdDiagnoseReadProof(parsed) {
  const proofRoot = requireFlag(parsed, "proof-root");
  const proofRel = requireFlag(parsed, "proof");
  if (hasFlag(parsed, "input-root") || hasFlag(parsed, "input") || hasFlag(parsed, "subject") || hasFlag(parsed, "conclusion-output")) {
    usageError("read-proof does not accept --input-root, --input, --subject, or --conclusion-output");
  }
  let content;
  try {
    const receipt = await readFileStrict(proofRoot, proofRel, { encoding: "utf8" });
    content = String(receipt.content);
  } catch (err) {
    emit(
      {
        ok: false,
        data: {
          status: "unavailable",
          reason: `Failed to read proof: ${errorMessage(err)}`,
          provider: null,
          conclusion: null
        },
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to read proof: ${errorMessage(err)}`
        }]
      },
      2
    );
  }
  let proof;
  try {
    proof = JSON.parse(content);
  } catch (err) {
    emit(
      {
        ok: false,
        data: {
          status: "unavailable",
          reason: `Failed to parse proof JSON: ${errorMessage(err)}`,
          provider: null,
          conclusion: null
        },
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to parse proof JSON: ${errorMessage(err)}`
        }]
      },
      2
    );
  }
  let result;
  try {
    result = diagnoseRegistry({
      mode: "read-proof",
      proof,
      expectedProviderId: REGISTRY_PROVIDER_ID
    });
  } catch (err) {
    emit(
      {
        ok: false,
        data: {
          status: "unavailable",
          reason: `Failed to interpret proof: ${errorMessage(err)}`,
          provider: null,
          conclusion: null
        },
        diagnostics: [{
          code: "INPUT_READ_FAILED",
          severity: "error",
          message: `Failed to interpret proof: ${errorMessage(err)}`
        }]
      },
      2
    );
  }
  const exitCode = result.status === "pass" ? 0 : result.status === "not_pass" ? 1 : 2;
  emit(
    {
      ok: result.status === "pass",
      data: result,
      diagnostics: []
    },
    exitCode
  );
}
function cmdMigrateRollback(parsed, transactionRoot) {
  const snapshotPath = requireFlag(parsed, "snapshot");
  const snapshotInput = readInput(snapshotPath);
  if (!snapshotInput.ok) {
    emit({ ok: false, diagnostics: snapshotInput.diagnostics }, 1);
  }
  const snapshot = snapshotInput.data;
  const result = rollbackMigration(snapshot, transactionRoot);
  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }
  emit({
    ok: true,
    data: {
      restoredPaths: result.restoredPaths
    },
    diagnostics: []
  }, 0);
}
var UNBIND_ALLOWED_FLAGS = /* @__PURE__ */ new Set([
  "project",
  "project-root",
  "method",
  "ref",
  "catalog",
  "include-disabled",
  "dry-run"
]);
function cmdUnbind(parsed) {
  rejectUnknownFlags(parsed, UNBIND_ALLOWED_FLAGS);
  rejectExtraPositionals(parsed, 2);
  const positionalMethod = parsed.positional[1];
  const flagMethod = optionalSingleton(parsed, "method");
  const flagRef = optionalSingleton(parsed, "ref");
  const providedIds = [positionalMethod, flagMethod, flagRef].filter(
    (v) => v !== void 0 && v.length > 0
  );
  if (providedIds.length === 0) {
    usageError(
      "unbind requires a target <method-id> (positional or via --method <id> / --ref <id>)",
      "Example: agent-method-registry unbind humanize-rewrite --project agent-methods.yaml"
    );
  }
  if (new Set(providedIds).size > 1) {
    usageError(
      "Conflicting method identifiers supplied via positional argument and --method / --ref flags",
      "Pass the target method identifier once."
    );
  }
  const methodId = providedIds[0];
  const projectPath = optionalSingleton(parsed, "project");
  const projectRoot = optionalSingleton(parsed, "project-root");
  if (!projectPath && !projectRoot) {
    usageError(
      "unbind requires either --project <file> or --project-root <dir>",
      "Pass --project agent-methods.yaml (or v2 binding file) or --project-root ."
    );
  }
  if (projectPath && projectRoot) {
    usageError(
      "unbind accepts either --project <file> or --project-root <dir>, not both",
      "Use --project for an explicit config path or --project-root to auto-discover agent-methods.yaml."
    );
  }
  const catalogPaths = requireNonEmptyRepeated(parsed, "catalog");
  const catalogDatas = [];
  const readDiags = [];
  for (const catPath of catalogPaths) {
    const input = readInput(catPath);
    if (!input.ok) {
      readDiags.push(...input.diagnostics);
    } else {
      catalogDatas.push(input.data);
    }
  }
  if (readDiags.length > 0) {
    emit({ ok: false, diagnostics: readDiags }, 1);
  }
  const result = unbindProjectMethod({
    methodId,
    projectPath,
    projectRoot,
    ...catalogDatas.length > 0 ? { catalogs: catalogDatas } : {},
    includeDisabled: hasFlag(parsed, "include-disabled"),
    dryRun: hasFlag(parsed, "dry-run")
  });
  if (!result.ok) {
    emit({ ok: false, diagnostics: result.diagnostics }, 1);
  }
  emit({ ok: true, data: result.data, diagnostics: result.diagnostics }, 0);
}
function cmdHelp() {
  emit(
    {
      ok: true,
      data: {
        commands: {
          validate: "agent-method-registry validate --catalog <file>... [--project <overlay-or-binding>]",
          index: "agent-method-registry index --catalog <file>... [--project <overlay>] [--out <index.json>]",
          query: "agent-method-registry query --index <file> [--candidate <file> | --domain <d> --artifact-type <t> --intent <i> --kind <workflow|operation> --limit <1..8> --format <compact|full>]",
          resolve: "agent-method-registry resolve --index <file> --ref <id> --host <host> [--plugin-root <dir>...] [--project-root <dir>...]",
          unbind: "agent-method-registry unbind <method-id> (--project <file> | --project-root <dir>) [--catalog <file>...] [--include-disabled] [--dry-run]",
          migrate: "agent-method-registry migrate (--dry-run | --apply | --rollback) ...",
          diagnose: "agent-method-registry diagnose --mode <professional-scan|read-proof> ..."
        },
        supportedHosts: [...SUPPORTED_HOST_LIST]
      },
      diagnostics: []
    },
    0
  );
}
function run(argv) {
  const parsed = parseArgs(argv);
  if (hasFlag(parsed, "help") || parsed.command === "help") {
    cmdHelp();
    return;
  }
  switch (parsed.command) {
    case "validate":
      cmdValidate(parsed);
      break;
    case "index":
      cmdIndex(parsed);
      break;
    case "query":
      cmdQuery(parsed);
      break;
    case "resolve":
      cmdResolve(parsed);
      break;
    case "unbind":
      cmdUnbind(parsed);
      break;
    case "migrate":
      cmdMigrate(parsed);
      break;
    case "diagnose":
      return cmdDiagnose(parsed);
    default:
      emit(
        {
          ok: false,
          diagnostics: [
            {
              code: "CLI_USAGE_ERROR",
              severity: "error",
              message: parsed.command ? `Unknown command: ${parsed.command}` : "No command specified. Use: validate | index | query | resolve | unbind | migrate | diagnose",
              suggestion: "Run `agent-method-registry --help` (read-only) to inspect available commands and flags."
            }
          ]
        },
        2
      );
  }
}

export {
  parseArgs,
  hasFlag,
  getFlag,
  getAllFlags,
  ExitError,
  emit,
  readInput,
  writeOutput,
  run
};
