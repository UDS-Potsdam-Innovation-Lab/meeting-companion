// The phone page's only contact with the desktop app: the token from the QR code and the session check.
// The token travels only in the URL fragment (never sent to a server, never in a Referer) and in the
// `Authorization: Bearer` header of API calls. Nothing is stored on the phone.
import type { Locale } from "../i18n";

/** Token characters the core sends (base64url); anything else is treated as no token. */
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Reads the token from `#t=<token>` and removes the fragment from the address bar at once, so it is
 * neither in the history entry nor on screen.
 */
export function takeToken(location: Location, history: History): string | null {
  const hash = location.hash;
  if (!hash) return null;
  history.replaceState(null, "", location.pathname + location.search);
  const token = new URLSearchParams(hash.slice(1)).get("t");
  return token && TOKEN.test(token) ? token : null;
}

export type SessionState = "open" | "closed";

/** Calls `fetch` for a path of this server with the token as bearer header; no cookies, no referrer. */
export function phoneFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
}

/** `GET /api/session`: 204 means the view is open for this token; anything else (or no answer) closed. */
export async function checkSession(token: string | null): Promise<SessionState> {
  if (!token) return "closed";
  try {
    const res = await phoneFetch(token, "/api/session");
    return res.status === 204 ? "open" : "closed";
  } catch {
    return "closed";
  }
}

/** The phone's language: `en…` gives English, everything else German (the default). */
export function phoneLocale(language: string | undefined): Locale {
  return language?.toLowerCase().startsWith("en") ? "en" : "de";
}
