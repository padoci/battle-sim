import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Much of the suite runs real battle search — synchronous, CPU-bound,
    // legitimately 10-80s per test (slower still on a loaded CI runner).
    // Vitest 4 fails sync tests retroactively when elapsed time exceeds
    // testTimeout, so the 5s default would fail healthy tests; hung-run
    // protection stays with the CI job timeout, not this value.
    testTimeout: 300_000,
  },
});
