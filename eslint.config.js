import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-e2e",
      "node_modules",
      "src-tauri/target",
      "src-tauri/gen",
      "screenshots",
      "playwright-report",
      "test-results",
      "design",
      "factory",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "19" } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      // Every user-facing string comes from src/i18n; literal text in JSX is an error.
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, noAttributeStrings: false }],
      // No HTML injection: user text is always rendered as text.
      "react/no-danger": "error",
    },
  },
  {
    // Only src/lib/ipc.ts may talk to Tauri (the mock backend for e2e and tests mirrors it).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/ipc.ts", "src/lib/mockBackend.ts", "src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@tauri-apps/*"], message: "Call Tauri only from src/lib/ipc.ts." }] },
      ],
    },
  },
  {
    // Classic browser scripts served as they are (the first-paint theme).
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "e2e/**/*.ts", "src/test/**"],
    rules: { "react/jsx-no-literals": "off" },
  },
);
