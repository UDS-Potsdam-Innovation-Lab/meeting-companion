import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// `npm run screenshot`: writes screenshots/<view>-<width>.png for the UI review.
export default defineConfig({
  ...base,
  testDir: "e2e/screenshots",
  testIgnore: undefined,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
