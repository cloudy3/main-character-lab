import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      process.env.E2E_PRODUCTION === "1"
        ? "npm start -- --port 3100"
        : "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100/api/status",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      AI_PROVIDER: "mock",
      DATA_DIR:
        process.env.E2E_DATA_DIR ||
        path.join(tmpdir(), `mcl-browser-${Date.now()}`),
    },
  },
});
