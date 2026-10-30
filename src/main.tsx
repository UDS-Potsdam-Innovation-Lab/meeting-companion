import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles.css";
import { App } from "./app/App";
import { I18nProvider } from "./i18n";

async function start() {
  // Browser-only builds for Playwright and screenshots replace the Tauri core with a fake.
  // In every other build this branch is removed at compile time.
  if (import.meta.env.VITE_MOCK_IPC === "1") {
    const { installMockBackend } = await import("./lib/mockBackend");
    installMockBackend();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}

void start();
