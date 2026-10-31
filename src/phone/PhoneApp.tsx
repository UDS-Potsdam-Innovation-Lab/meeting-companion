import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { CheckIcon, LogoMark, PowerIcon, QrIcon } from "../ui/icons";
import { checkSession, type SessionState } from "./session";

type State = "checking" | SessionState;

interface Props {
  token: string | null;
  /** The session check (tests pass a fake). */
  check?: (token: string | null) => Promise<SessionState>;
  /**
   * The consumer view to show while connected (010's voice pages, later 08's review). Without one the
   * page waits with "Connected to the meeting screen".
   */
  children?: ReactNode;
}

/**
 * The phone page shell: header with the app name and a status, one consumer slot, a footer. It shows
 * nothing from the meeting. Once closed it stays closed: the phone cannot reopen the view.
 */
export function PhoneApp({ token, check = checkSession, children }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let active = true;
    let closed = false;
    const run = () => {
      if (closed) return;
      void check(token).then((next) => {
        if (!active || closed) return;
        if (next === "closed") closed = true;
        setState(next);
      });
    };
    run();
    // Back on screen (another app, a locked phone): the view may have closed meanwhile.
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, check]);

  return (
    <div className="phone" data-state={state}>
      <header className="phone-header">
        <span className="phone-header__mark" aria-hidden="true">
          <LogoMark />
        </span>
        <p className="phone-header__name">{t("phone.appName")}</p>
        <span className={`phone-status phone-status--${state}`} role="status">
          {state === "open" && (
            <>
              <span className="phone-status__dot" aria-hidden="true" />
              {t("phone.status.connected")}
            </>
          )}
          {state === "closed" && (
            <>
              <span className="phone-status__ring" aria-hidden="true" />
              {t("phone.status.closed")}
            </>
          )}
        </span>
      </header>
      <main className="phone-body" aria-busy={state === "checking"}>
        {state === "open" && (
          <div className="phone-slot" data-consumer-slot="">
            {children ?? <Waiting />}
          </div>
        )}
        {state === "closed" && <Closed />}
      </main>
      <footer className="phone-footer">
        <p>{t(state === "closed" ? "phone.footer.closed" : "phone.footer.open")}</p>
      </footer>
    </div>
  );
}

function Waiting() {
  const { t } = useI18n();
  return (
    <section className="phone-card" aria-labelledby="phone-waiting-title">
      <span className="phone-card__icon phone-card__icon--ok" aria-hidden="true">
        <CheckIcon />
      </span>
      <h1 id="phone-waiting-title" className="phone-card__title">
        {t("phone.waiting.title")}
      </h1>
      <p className="phone-card__text">{t("phone.waiting.text")}</p>
    </section>
  );
}

function Closed() {
  const { t } = useI18n();
  return (
    <section className="phone-card phone-card--closed" aria-labelledby="phone-closed-title">
      <span className="phone-card__icon" aria-hidden="true">
        <PowerIcon />
      </span>
      <h1 id="phone-closed-title" className="phone-card__title phone-card__title--closed">
        {t("phone.closed.title")}
      </h1>
      <p className="phone-card__text">{t("phone.closed.text")}</p>
      <div className="phone-hint">
        <span className="phone-hint__glyph" aria-hidden="true">
          <QrIcon />
        </span>
        <p>{t("phone.closed.hint")}</p>
      </div>
    </section>
  );
}
