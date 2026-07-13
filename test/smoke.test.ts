import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('package exports are defined', async () => {
    const mod = await import('../src/index.js');
    expect(mod).toBeDefined();
  });

  it('no forbidden packages exist', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(fs.existsSync(path.join(root, 'packages/core'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'packages/cli'))).toBe(false);
  });
});
