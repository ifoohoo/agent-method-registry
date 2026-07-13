import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const VALID_CATALOG = resolve(FIXTURES, 'catalogs/valid-plugin.yaml');
const VALID_CATALOG_2 = resolve(FIXTURES, 'catalogs/valid-plugin-2.yaml');
const INVALID_CATALOG = resolve(FIXTURES, 'catalogs/invalid-missing-id.yaml');
const VALID_PROJECT = resolve(FIXTURES, 'projects/valid-overlay.yaml');
const VALID_PROJECT_2 = resolve(FIXTURES, 'projects/valid-overlay-2.yaml');

let cli: typeof import('../src/cli.js');

beforeEach(async () => {
  cli = await import('../src/cli.js');
});

// Helper: run CLI and catch ExitError so tests can inspect stdout/exitCode
function runCli(argv: string[]): void {
  try {
    cli.run(argv);
  } catch (e) {
    if (e instanceof cli.ExitError) return; // expected in tests
    throw e;
  }
}

// ── parseArgs ────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('parses command as first non-flag arg', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate', '--catalog', 'a.yaml']);
    expect(parsed.command).toBe('validate');
  });

  it('returns undefined command when no positional args', () => {
    const parsed = cli.parseArgs(['node', 'cli.js']);
    expect(parsed.command).toBeUndefined();
    expect(parsed.positional).toEqual([]);
  });

  it('parses --flag value pairs', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'index', '--catalog', 'a.yaml', '--project', 'p.yaml']);
    expect(parsed.flags['catalog']).toEqual(['a.yaml']);
    expect(parsed.flags['project']).toEqual(['p.yaml']);
  });

  it('repeated flags accumulate in array', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate', '--catalog', 'a.yaml', '--catalog', 'b.yaml']);
    expect(parsed.flags['catalog']).toEqual(['a.yaml', 'b.yaml']);
  });

  it('bare flag stores empty string', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate', '--verbose']);
    expect(parsed.flags['verbose']).toEqual(['']);
  });

  it('--flag=value stores value correctly', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'index', '--out', 'result.json']);
    expect(parsed.flags['out']).toEqual(['result.json']);
  });

  it('positional args after flags are collected', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate', '--catalog', 'a.yaml', 'extra']);
    expect(parsed.positional).toEqual(['validate', 'extra']);
  });
});

// ── hasFlag / getFlag / getAllFlags ──────────────────────────────

describe('hasFlag / getFlag / getAllFlags', () => {
  it('hasFlag returns true when flag present', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate', '--catalog', 'a.yaml']);
    expect(cli.hasFlag(parsed, 'catalog')).toBe(true);
    expect(cli.hasFlag(parsed, 'project')).toBe(false);
  });

  it('getFlag returns first value', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate', '--catalog', 'a.yaml', '--catalog', 'b.yaml']);
    expect(cli.getFlag(parsed, 'catalog')).toBe('a.yaml');
  });

  it('getFlag returns undefined for missing flag', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate']);
    expect(cli.getFlag(parsed, 'catalog')).toBeUndefined();
  });

  it('getAllFlags returns all values', () => {
    const parsed = cli.parseArgs(['node', 'cli.js', 'validate', '--catalog', 'a.yaml', '--catalog', 'b.yaml']);
    expect(cli.getAllFlags(parsed, 'catalog')).toEqual(['a.yaml', 'b.yaml']);
  });
});

// ── emit ─────────────────────────────────────────────────────────

describe('emit', () => {
  let stdout: string;
  let exitCode: number | undefined;
  let originalWrite: typeof process.stdout.write;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    stdout = '';
    exitCode = undefined;
    originalWrite = process.stdout.write;
    originalExit = process.exit;
    // @ts-expect-error mock
    process.stdout.write = (chunk: unknown) => {
      stdout += String(chunk);
      return true;
    };
    // @ts-expect-error mock
    process.exit = ((code: number) => {
      exitCode = code;
      return undefined as never;
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.exit = originalExit;
  });

  it('outputs JSON envelope with ok, data, diagnostics and calls process.exit', () => {
    try { cli.emit({ ok: true, data: { foo: 'bar' }, diagnostics: [] }, 0); } catch (e) { if (!(e instanceof cli.ExitError)) throw e; }
    const output = JSON.parse(stdout);
    expect(output).toEqual({ ok: true, data: { foo: 'bar' }, diagnostics: [] });
    expect(exitCode).toBe(0);
  });

  it('outputs diagnostics on failure', () => {
    const diag = { code: 'INVALID_CATALOG' as const, severity: 'error' as const, message: 'bad' };
    try { cli.emit({ ok: false, diagnostics: [diag] }, 1); } catch (e) { if (!(e instanceof cli.ExitError)) throw e; }
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
    expect(output.diagnostics).toHaveLength(1);
    expect(exitCode).toBe(1);
  });

  it('no timestamps in output', () => {
    try { cli.emit({ ok: true, diagnostics: [] }, 0); } catch (e) { if (!(e instanceof cli.ExitError)) throw e; }
    const output = JSON.parse(stdout);
    expect(output).not.toHaveProperty('timestamp');
    expect(output).not.toHaveProperty('duration');
    expect(output).not.toHaveProperty('ts');
  });
});

// ── readInput ────────────────────────────────────────────────────

describe('readInput', () => {
  it('reads YAML files', () => {
    const result = cli.readInput(VALID_CATALOG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).schemaVersion).toBe(1);
    }
  });

  it('reads JSON files', () => {
    const jsonPath = resolve(FIXTURES, 'catalogs/valid-plugin.json');
    const result = cli.readInput(jsonPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).schemaVersion).toBe(1);
    }
  });

  it('returns INPUT_READ_FAILED for non-existent file', () => {
    const result = cli.readInput('/nonexistent/path.yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe('INPUT_READ_FAILED');
    }
  });

  it('returns INPUT_READ_FAILED for invalid YAML', () => {
    const tmpDir = join(tmpdir(), `cli-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const badFile = join(tmpDir, 'bad.yaml');
    writeFileSync(badFile, '{{invalid yaml::');
    try {
      const result = cli.readInput(badFile);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0].code).toBe('INPUT_READ_FAILED');
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── writeOutput ──────────────────────────────────────────────────

describe('writeOutput', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `cli-write-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes JSON to file', () => {
    const outFile = join(tmpDir, 'out.json');
    const result = cli.writeOutput(outFile, { hello: 'world' });
    expect(result.ok).toBe(true);
    const content = JSON.parse(readFileSync(outFile, 'utf-8'));
    expect(content).toEqual({ hello: 'world' });
  });

  it('returns OUTPUT_WRITE_FAILED for unwritable path', () => {
    const result = cli.writeOutput('/nonexistent/deep/path/out.json', { x: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe('OUTPUT_WRITE_FAILED');
    }
  });
});

// ── validate command ─────────────────────────────────────────────

describe('run("validate")', () => {
  let stdout: string;
  let exitCode: number | undefined;
  let originalWrite: typeof process.stdout.write;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    stdout = '';
    exitCode = undefined;
    originalWrite = process.stdout.write;
    originalExit = process.exit;
    // @ts-expect-error mock
    process.stdout.write = (chunk: unknown) => {
      stdout += String(chunk);
      return true;
    };
    // @ts-expect-error mock
    process.exit = ((code: number) => {
      exitCode = code;
      return undefined as never;
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.exit = originalExit;
  });

  it('exit 0 for valid catalog', () => {
    runCli(['node', 'cli.js', 'validate', '--catalog', VALID_CATALOG]);
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(true);
    expect(output.diagnostics).toEqual([]);
  });

  it('exit 0 for multiple valid catalogs', () => {
    runCli(['node', 'cli.js', 'validate', '--catalog', VALID_CATALOG, '--catalog', VALID_CATALOG_2]);
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(true);
  });

  it('exit 0 for valid catalog + valid project overlay', () => {
    runCli(['node', 'cli.js', 'validate', '--catalog', VALID_CATALOG, '--project', VALID_PROJECT]);
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(true);
  });

  it('exit 1 for invalid catalog', () => {
    runCli(['node', 'cli.js', 'validate', '--catalog', INVALID_CATALOG]);
    expect(exitCode).toBe(1);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
    expect(output.diagnostics.length).toBeGreaterThan(0);
    expect(output.diagnostics[0].code).toBe('INVALID_CATALOG');
  });

  it('exit 2 when --catalog is missing', () => {
    runCli(['node', 'cli.js', 'validate']);
    expect(exitCode).toBe(2);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
    expect(output.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 1 when input file not readable', () => {
    runCli(['node', 'cli.js', 'validate', '--catalog', '/nonexistent/bad.yaml']);
    expect(exitCode).toBe(1);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
    expect(output.diagnostics[0].code).toBe('INPUT_READ_FAILED');
  });

  it('stdout always has {ok, data, diagnostics} shape', () => {
    runCli(['node', 'cli.js', 'validate', '--catalog', VALID_CATALOG]);
    const output = JSON.parse(stdout);
    expect(output).toHaveProperty('ok');
    expect(output).toHaveProperty('diagnostics');
    expect(output).toHaveProperty('data');
  });

  it('no timestamps in output', () => {
    runCli(['node', 'cli.js', 'validate', '--catalog', VALID_CATALOG]);
    const output = JSON.parse(stdout);
    expect(output).not.toHaveProperty('timestamp');
    expect(output).not.toHaveProperty('duration');
    expect(output).not.toHaveProperty('ts');
    expect(output).not.toHaveProperty('time');
  });
});

// ── index command ────────────────────────────────────────────────

describe('run("index")', () => {
  let stdout: string;
  let exitCode: number | undefined;
  let originalWrite: typeof process.stdout.write;
  let originalExit: typeof process.exit;
  let tmpDir: string;

  beforeEach(() => {
    stdout = '';
    exitCode = undefined;
    originalWrite = process.stdout.write;
    originalExit = process.exit;
    // @ts-expect-error mock
    process.stdout.write = (chunk: unknown) => {
      stdout += String(chunk);
      return true;
    };
    // @ts-expect-error mock
    process.exit = ((code: number) => {
      exitCode = code;
      return undefined as never;
    }) as typeof process.exit;
    tmpDir = join(tmpdir(), `cli-index-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.exit = originalExit;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exit 0 for valid index build', () => {
    runCli(['node', 'cli.js', 'index', '--catalog', VALID_CATALOG]);
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(true);
    expect(output.data.schemaVersion).toBe(1);
    expect(output.data.entries).toBeDefined();
    expect(output.diagnostics).toEqual([]);
  });

  it('index with --out writes raw index (no envelope)', () => {
    const outFile = join(tmpDir, 'index.json');
    runCli(['node', 'cli.js', 'index', '--catalog', VALID_CATALOG, '--out', outFile]);
    expect(exitCode).toBe(0);
    // stdout still has envelope
    const stdoutOutput = JSON.parse(stdout);
    expect(stdoutOutput.ok).toBe(true);
    // file has raw index (no ok/diagnostics envelope)
    const fileContent = JSON.parse(readFileSync(outFile, 'utf-8'));
    expect(fileContent).not.toHaveProperty('ok');
    expect(fileContent).not.toHaveProperty('diagnostics');
    expect(fileContent.schemaVersion).toBe(1);
    expect(fileContent.entries).toBeDefined();
  });

  it('exit 1 when --out path is unwritable', () => {
    runCli(['node', 'cli.js', 'index', '--catalog', VALID_CATALOG, '--out', '/nonexistent/deep/index.json']);
    expect(exitCode).toBe(1);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
    expect(output.diagnostics.some((d: { code: string }) => d.code === 'OUTPUT_WRITE_FAILED')).toBe(true);
  });

  it('exit 2 when --catalog is missing', () => {
    runCli(['node', 'cli.js', 'index']);
    expect(exitCode).toBe(2);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
    expect(output.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });

  it('exit 1 for invalid catalog input', () => {
    runCli(['node', 'cli.js', 'index', '--catalog', INVALID_CATALOG]);
    expect(exitCode).toBe(1);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
  });

  it('stdout always has {ok, data, diagnostics} shape', () => {
    runCli(['node', 'cli.js', 'index', '--catalog', VALID_CATALOG]);
    const output = JSON.parse(stdout);
    expect(output).toHaveProperty('ok');
    expect(output).toHaveProperty('data');
    expect(output).toHaveProperty('diagnostics');
  });

  it('no timestamps in output', () => {
    runCli(['node', 'cli.js', 'index', '--catalog', VALID_CATALOG]);
    const output = JSON.parse(stdout);
    for (const key of Object.keys(output)) {
      expect(key).not.toMatch(/time|stamp|duration|ts/i);
    }
  });

  it('exit 2 for unknown command', () => {
    runCli(['node', 'cli.js', 'unknown']);
    expect(exitCode).toBe(2);
    const output = JSON.parse(stdout);
    expect(output.ok).toBe(false);
    expect(output.diagnostics[0].code).toBe('CLI_USAGE_ERROR');
  });
});
