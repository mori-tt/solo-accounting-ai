import { defineConfig } from "vitest/config";

// Firebase Emulator上でSecurity Rulesを検証するテスト用設定。
// `pnpm test:rules`(firebase emulators:exec経由)から実行する。
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Emulatorの状態を共有するため直列で実行する
    fileParallelism: false,
  },
});
