import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Password hashing deliberately uses a memory-hard algorithm and can exceed
    // Vitest's five-second default while database suites run in parallel on CI.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
  },
});
