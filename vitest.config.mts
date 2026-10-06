import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside the React server runtime; stub it in tests.
    alias: { "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/db/database.types.ts", "**/*.test.ts"],
      // The money engine must stay fully covered.
      thresholds: {
        "lib/splits/**": { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
