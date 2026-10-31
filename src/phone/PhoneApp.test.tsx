// Job 012 AC7: the phone page shell.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, type Locale } from "../i18n";
import de from "../i18n/de.json";
import en from "../i18n/en.json";
import { PhoneApp } from "./PhoneApp";
import { checkSession, phoneLocale, takeToken, type SessionState } from "./session";

const TOKEN = "FAKE-TOKEN-for-tests-only";

function renderPhone(
  check: (t: string | null) => Promise<SessionState>,
  locale: Locale = "en",
  keyMode = false,
) {
  return render(
    <I18nProvider fixedLocale={locale} keyMode={keyMode}>
      <PhoneApp token={TOKEN} check={check} />
    </I18nProvider>,
  );
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("AC7 the phone page", () => {
  it("shows Connected with the app name and the waiting card in the consumer slot", async () => {
    const { container } = renderPhone(() => Promise.resolve("open"));
    expect(await screen.findByRole("heading", { name: en["phone.waiting.title"] })).toBeInTheDocument();
    expect(screen.getByText(en["phone.appName"])).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(en["phone.status.connected"]);
    expect(screen.getByText(en["phone.footer.open"])).toBeInTheDocument();
    const slot = container.querySelector("[data-consumer-slot]");
    expect(slot).not.toBeNull();
    expect(slot).toContainElement(screen.getByRole("heading"));
    // The shell has no controls.
    expect(container.querySelectorAll("button, a, input, select, textarea")).toHaveLength(0);
  });

  it("puts a consumer view into the slot instead of the waiting card", async () => {
    render(
      <I18nProvider fixedLocale="en">
        <PhoneApp token={TOKEN} check={() => Promise.resolve("open")}>
          <p>consumer view</p>
        </PhoneApp>
      </I18nProvider>,
    );
    expect(await screen.findByText("consumer view")).toBeInTheDocument();
    expect(screen.queryByText(en["phone.waiting.title"])).toBeNull();
  });

  it("shows This page is closed with the hint to scan again on a refused check, and offers no way back", async () => {
    const { container } = renderPhone(() => Promise.resolve("closed"));
    expect(await screen.findByRole("heading", { name: en["phone.closed.title"] })).toBeInTheDocument();
    expect(screen.getByText(en["phone.closed.text"])).toBeInTheDocument();
    expect(screen.getByText(en["phone.closed.hint"])).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(en["phone.status.closed"]);
    expect(screen.getByText(en["phone.footer.closed"])).toBeInTheDocument();
    expect(container.querySelector("[data-consumer-slot]")).toBeNull();
    expect(container.querySelectorAll("button, a")).toHaveLength(0);
  });

  it("checks again when the page becomes visible and closes on a failed check, for good", async () => {
    let answer: SessionState = "open";
    const check = vi.fn(() => Promise.resolve(answer));
    renderPhone(check);
    await screen.findByText(en["phone.status.connected"]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(TOKEN);
    // Hidden: no check.
    await act(async () => setVisibility("hidden"));
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => setVisibility("visible"));
    expect(check).toHaveBeenCalledTimes(2);
    expect(screen.getByText(en["phone.status.connected"])).toBeInTheDocument();
    answer = "closed";
    await act(async () => setVisibility("visible"));
    expect(await screen.findByText(en["phone.closed.title"])).toBeInTheDocument();
    // Once closed, it stays closed and stops asking.
    answer = "open";
    await act(async () => setVisibility("visible"));
    expect(check).toHaveBeenCalledTimes(3);
    expect(screen.getByText(en["phone.closed.title"])).toBeInTheDocument();
  });

  it("speaks German", async () => {
    renderPhone(() => Promise.resolve("open"), "de");
    expect(await screen.findByText(de["phone.waiting.title"])).toBeInTheDocument();
    expect(screen.getByText(de["phone.status.connected"])).toBeInTheDocument();
  });

  it("renders every string from a key (no literals)", async () => {
    for (const answer of ["open", "closed"] as const) {
      const { container, unmount } = renderPhone(() => Promise.resolve(answer), "en", true);
      await screen.findByRole("heading");
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const offenders: string[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent?.trim() ?? "";
        if (text && !/^(⟦[\w.]+⟧\s*)+$/.test(text)) offenders.push(text);
      }
      for (const el of container.querySelectorAll("[aria-label], [title], [alt]")) {
        offenders.push(el.outerHTML);
      }
      expect(offenders).toEqual([]);
      unmount();
    }
  });

  it("has no inline style attribute (the page's CSP allows no inline style)", async () => {
    for (const answer of ["open", "closed"] as const) {
      const { container, unmount } = renderPhone(() => Promise.resolve(answer));
      await screen.findByRole("heading");
      expect(container.querySelectorAll("[style]")).toHaveLength(0);
      unmount();
    }
  });
});

describe("AC7 token and language", () => {
  function fakeLocation(hash: string) {
    const replace = vi.fn();
    const location = { hash, pathname: "/", search: "" } as Location;
    const history = { replaceState: replace } as unknown as History;
    return { location, history, replace };
  }

  it("reads the token from the fragment and removes it from the address bar", () => {
    const { location, history, replace } = fakeLocation(`#t=${TOKEN}`);
    expect(takeToken(location, history)).toBe(TOKEN);
    expect(replace).toHaveBeenCalledWith(null, "", "/");
  });

  it("treats a missing or malformed token as none, and still clears the fragment", () => {
    for (const hash of ["#t=", "#t=a%20b", "#t=<script>", "#x=1", `#t=${"a".repeat(200)}`]) {
      const { location, history, replace } = fakeLocation(hash);
      expect(takeToken(location, history), hash).toBeNull();
      expect(replace).toHaveBeenCalled();
    }
    const { location, history, replace } = fakeLocation("");
    expect(takeToken(location, history)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("asks GET /api/session with the bearer token only; 204 is open, anything else closed", async () => {
    const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkSession(TOKEN)).toBe("open");
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/session");
    expect(new Headers(init!.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(init!.credentials).toBe("omit");
    expect(init!.referrerPolicy).toBe("no-referrer");
    expect(path).not.toContain(TOKEN);

    for (const status of [403, 429, 200, 500]) {
      fetchMock.mockResolvedValueOnce(new Response(status === 200 ? "{}" : null, { status }));
      expect(await checkSession(TOKEN), String(status)).toBe("closed");
    }
    fetchMock.mockRejectedValueOnce(new TypeError("network"));
    expect(await checkSession(TOKEN)).toBe("closed");
    fetchMock.mockClear();
    expect(await checkSession(null)).toBe("closed");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("follows the phone's language, German by default", () => {
    expect(phoneLocale("en-US")).toBe("en");
    expect(phoneLocale("EN")).toBe("en");
    expect(phoneLocale("de-DE")).toBe("de");
    expect(phoneLocale("fr-FR")).toBe("de");
    expect(phoneLocale(undefined)).toBe("de");
  });
});
