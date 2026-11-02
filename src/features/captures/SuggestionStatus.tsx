import { useI18n, type MessageKey } from "../../i18n";
import { SparkleIcon } from "../../ui/icons";
import type { SuggestErrorLine, SuggestStatus } from "./suggestions";

const ERROR_KEYS: Record<SuggestErrorLine, MessageKey> = {
  offline: "suggest.status.error.offline",
  noApiKey: "suggest.status.error.noApiKey",
  unauthorized: "suggest.status.error.unauthorized",
  rateLimited: "suggest.status.error.rateLimited",
  noModel: "suggest.status.error.noModel",
  failed: "suggest.status.error.failed",
};

/**
 * Frame 21s "Status line": one line under the composer that says where the transcript text goes, from
 * the `languageModel` setting: off (with the way to choose a model), on this device, or to Anthropic.
 * An engine error replaces it quietly with a glyph and words; it is never modal and never retries.
 */
export function SuggestionStatusLine({
  status,
  onChooseModel,
}: {
  status: SuggestStatus;
  onChooseModel: () => void;
}) {
  const { t } = useI18n();
  return (
    <p
      className={`suggest-status suggest-status--${status.kind}`}
      data-testid="suggest-status"
      data-state={status.kind === "error" ? status.error : status.kind}
    >
      {status.kind === "off" ? (
        <>
          <span className="suggest-status__glyph" aria-hidden="true">
            {t("suggest.glyph.off")}
          </span>
          <span>{t("suggest.status.off")} </span>
          <button type="button" className="suggest-status__link" onClick={onChooseModel}>
            {t("suggest.status.offLink")}
          </button>
        </>
      ) : status.kind === "local" ? (
        <>
          <span className="suggest-status__glyph suggest-status__glyph--icon" aria-hidden="true">
            <SparkleIcon />
          </span>
          <span>{t("suggest.status.local")}</span>
        </>
      ) : status.kind === "cloud" ? (
        <>
          <span className="cloud-badge">{t("suggest.status.cloudBadge")}</span>
          <span>{t("suggest.status.cloud")}</span>
        </>
      ) : (
        <>
          <span className="suggest-status__glyph suggest-status__glyph--error" aria-hidden="true">
            {t("suggest.glyph.error")}
          </span>
          <span>{t(ERROR_KEYS[status.error])}</span>
        </>
      )}
    </p>
  );
}

/** The top-bar chip while Claude is chosen and the meeting records. */
export function CloudSuggestChip() {
  const { t } = useI18n();
  return (
    <span className="suggest-top-chip" data-testid="suggest-cloud-chip">
      <span className="suggest-top-chip__full">{t("suggest.topChip")}</span>
      {/* Narrower bars show the short form; the full text stays for screen readers. */}
      <span className="suggest-top-chip__short" aria-hidden="true">
        {t("suggest.topChipShort")}
      </span>
    </span>
  );
}
