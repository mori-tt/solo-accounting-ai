import { defineConfig, devices } from "@playwright/test";

// 他の dev server / Emulator と衝突しないよう E2E_PORT でポートを切替可能にする
// (AGENTS.md: next dev の同時起動は全worktree通して1系統まで)
const port = process.env.E2E_PORT ?? "3000";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html"]] : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  expect: {
    // dev server の初回コンパイルと Server Action 往復を考慮して長めに
    timeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
