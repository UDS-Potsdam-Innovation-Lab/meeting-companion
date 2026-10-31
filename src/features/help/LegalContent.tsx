import { useI18n, type MessageKey } from "../../i18n";
import { ORGANISATION_FIELDS, type OrganisationLoad } from "../../lib/ipc";
import { useSettings } from "../settings/useSettings";
import { HelpCard } from "./HelpCard";
import { Licences } from "./Licences";
import { PRIVACY_PARAGRAPHS, PRIVACY_SLOTS } from "./sections";
import { useOrganisation } from "./useOrganisation";

/** Shown until the core has answered (only in a browser build without the core). */
const FALLBACK_FOLDER = "<app_data>/meetings";
const FALLBACK_FILE = "<app_data>/organisation.json";

/**
 * The privacy notice (GDPR Art. 13): what the app does today, statement by statement, each one key.
 * The order is the frame's (19c). Paragraphs of later features go into their slots.
 */
function PrivacyNotice() {
  const { t } = useI18n();
  const { storageFolder } = useSettings();
  const part = (key: string, ...bodies: MessageKey[]) => (
    <div className="privacy__part" data-privacy={key}>
      <h3 className="privacy__title">{t(`legal.privacy.${key}.title` as MessageKey)}</h3>
      {bodies.map((b) => (
        <p key={b} className="privacy__body" data-key={b}>
          {b === "legal.privacy.stored.body" ? t(b, { folder: storageFolder || FALLBACK_FOLDER }) : t(b)}
        </p>
      ))}
    </div>
  );
  return (
    <HelpCard id="privacy" title={t("legal.privacy.title")} sub={t("legal.privacy.version")}>
      <div className="privacy">
        {part("recorded", "legal.privacy.recorded.body", "legal.privacy.audio", "legal.privacy.level")}
        {part("stored", "legal.privacy.stored.body")}
        {part("leaves", "legal.privacy.leaves.body")}
        {part("consent", "legal.privacy.consent.body")}
        {part("retention", "legal.privacy.retention.body")}
        {PRIVACY_SLOTS.map((slot) => {
          const Paragraph = PRIVACY_PARAGRAPHS[slot];
          return Paragraph ? (
            <div key={slot} id={slot} className="privacy__part">
              <Paragraph />
            </div>
          ) : null;
        })}
        {part("controller", "legal.privacy.controller.body")}
      </div>
    </HelpCard>
  );
}

/** The texts of the consent prompt (TranscriptPanel), by the same keys: one change shows in both. */
function ConsentTexts() {
  const { t } = useI18n();
  return (
    <HelpCard id="consent-texts" title={t("legal.consent.title")} sub={t("legal.consent.sub")}>
      <div className="consent-copy">
        <h3 className="consent-copy__title">{t("consent.title")}</h3>
        <p className="consent-copy__check">
          <span className="consent-copy__box" aria-hidden="true" />
          <span>{t("consent.check")}</span>
        </p>
        <p className="consent-copy__local">{t("consent.local")}</p>
      </div>
    </HelpCard>
  );
}

const ORG_LABEL: Record<(typeof ORGANISATION_FIELDS)[number], MessageKey> = {
  name: "legal.org.name",
  address: "legal.org.address",
  controller: "legal.org.controller",
  dpoContact: "legal.org.dpoContact",
  contact: "legal.org.contact",
  imprintUrl: "legal.org.imprintUrl",
};

/**
 * The imprint and controller block from the IT-deployed `organisation.json`. Every value is
 * rendered as text: no HTML, no links (an address that looks like a URL stays text).
 */
export function OrganisationBlock({ load }: { load: OrganisationLoad | null }) {
  const { t } = useI18n();
  const path = load?.path || FALLBACK_FILE;
  const org = load?.status === "found" ? load.organisation : null;
  const rows = org
    ? ORGANISATION_FIELDS.flatMap((f) => {
        const value = org[f];
        return typeof value === "string" && value.trim() !== "" ? [{ field: f, value }] : [];
      })
    : [];
  return (
    <HelpCard id="organisation" title={t("legal.org.title")} sub={t("legal.org.sub")}>
      <div className="org" aria-busy={load === null}>
        {load === null ? null : rows.length > 0 ? (
          <>
            <dl className="org__list">
              {rows.map(({ field, value }) => (
                <div key={field} className="org__row" data-field={field}>
                  <dt className="org__label">{t(ORG_LABEL[field])}</dt>
                  <dd className="org__value">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="org__source">{t("legal.org.source", { path })}</p>
          </>
        ) : (
          <>
            {load.status === "invalid" ? (
              <div className="settings-notice settings-notice--warn" role="status">
                <span className="settings-notice__icon" aria-hidden="true" />
                <div className="settings-notice__text">
                  <p className="settings-notice__title">{t("legal.org.invalid.title")}</p>
                  <p className="settings-notice__body">{t("legal.org.invalid.body")}</p>
                </div>
              </div>
            ) : null}
            <div className="org__placeholder" data-testid="org-placeholder">
              <p className="org__placeholder-title">{t("legal.org.none.title")}</p>
              <p className="org__placeholder-body">{t("legal.org.none.body", { path })}</p>
            </div>
          </>
        )}
      </div>
    </HelpCard>
  );
}

/** The "Legal notes" tab (frames 19c, 19d). */
export function LegalContent() {
  const { t } = useI18n();
  const organisation = useOrganisation();
  return (
    <>
      <PrivacyNotice />
      <ConsentTexts />
      <OrganisationBlock load={organisation} />
      <HelpCard id="licences" title={t("legal.licences.title")} sub={t("legal.licences.sub")}>
        <Licences />
      </HelpCard>
    </>
  );
}
