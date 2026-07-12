import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = process.env.PW_REUSE_EXISTING === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../.run/playwright/test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      command: "../backend/.venv/bin/python -m uvicorn server:app --app-dir ../backend --host 127.0.0.1 --port 8080",
      url: "http://127.0.0.1:8080/health",
      env: { OPENAI_API_KEY: "", OPENAI_BASE_URL: "", OPENAI_MODEL: "deepseek-chat" },
      reuseExistingServer,
      timeout: 120_000,
    },
  ],
});
