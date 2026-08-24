import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env["HINA_E2E_PORT"] ?? "4173", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("HINA_E2E_PORT must be an integer between 1 and 65535.");
}

const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./output/playwright/e2e-next",
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: process.env["CI"] === undefined ? 0 : 1,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    acceptDownloads: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    env: {
      HINA_E2E_PORT: String(port),
    },
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 10_000,
    },
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 600_000,
    url: baseURL,
  },
});
