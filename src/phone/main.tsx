import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../styles.css";
import "./phone.css";
import { I18nProvider, messages } from "../i18n";
import { PhoneApp } from "./PhoneApp";
import { phoneLocale, takeToken } from "./session";

// The phone page served by the desktop app over the local network (job 012). The token leaves the
// address bar before anything renders.
const token = takeToken(window.location, window.history);
const locale = phoneLocale(navigator.language);

// The phone's light/dark setting; there is no switch on the phone.
const dark = window.matchMedia?.("(prefers-color-scheme: dark)");
const applyTheme = () =>
  document.documentElement.setAttribute("data-theme", dark?.matches ? "dark" : "light");
applyTheme();
dark?.addEventListener("change", applyTheme);
document.title = messages[locale]["phone.appName"];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider fixedLocale={locale}>
      <PhoneApp token={token} />
    </I18nProvider>
  </StrictMode>,
);
