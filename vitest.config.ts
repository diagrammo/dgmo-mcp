import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Prevent src/index.ts from grabbing stdio when imported by the harness.
    env: { DGMO_MCP_TEST: '1' },
    // Tool calls render/migrate via the bundled dgmo — give them headroom.
    testTimeout: 20000,
  },
});
