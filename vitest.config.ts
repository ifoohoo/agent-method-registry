import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Run test files sequentially to prevent race conditions on shared dist/.
    // Multiple test files (dist-cleanliness, dist-blackbox) rebuild dist in
    // beforeAll; tarball-audit reads dist state. Concurrent execution causes
    // npm pack to capture stale artifacts.
    fileParallelism: false,
  },
});
