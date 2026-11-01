import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // tests/rules はEmulator必須のため `pnpm test:rules` で別途実行する
    exclude: ["e2e/**", "node_modules/**", "tests/rules/**"],
  },
});
