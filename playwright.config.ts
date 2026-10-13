import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 240000,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm start -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
