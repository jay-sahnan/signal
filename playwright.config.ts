import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1, // sequential -- tests share DB state
  use: {
    baseURL: "http://localhost:3000",
    extraHTTPHeaders: {
      "Content-Type": "application/json",
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: "auth",
      testMatch: /(auth\.flow|api\.auth)\.test\.ts/,
      use: { browserName: "chromium" },
    },
    {
      name: "api",
      testMatch: /api\.(?!auth\.).*\.test\.ts/,
    },
    {
      name: "pages",
      testMatch: /pages\..*\.test\.ts/,
      use: { browserName: "chromium" },
    },
    {
      name: "knowledge-base",
      testMatch: /knowledge-base\..*\.test\.ts/,
    },
    {
      name: "signals",
      testMatch: /signals\.test\.ts/,
      use: { browserName: "chromium" },
    },
  ],
});
