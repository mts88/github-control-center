import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
  },
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL("./tests/vscode-mock.ts", import.meta.url)),
    },
  },
});
