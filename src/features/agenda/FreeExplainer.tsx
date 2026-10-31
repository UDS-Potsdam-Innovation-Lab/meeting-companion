import { useI18n } from "../../i18n";
import { HalfIcon, PlusIcon, StopwatchIcon } from "../../ui/icons";
import { slotMinutes, type Meeting } from "./model";

/**
 * Frame 16a: what replaces the agenda list in agenda-free mode. Three lines on what the meeting does,
 * and a note that typed agenda items are kept.
 */
export function FreeExplainer({ meeting }: { meeting: Meeting }) {
  const { t, tp } = useI18n();
  const kept = meeting.items.length;
  return (
    <>
      <section className="card free-explainer" aria-labelledby="free-explainer-heading">
        <h2 id="free-explainer-heading" className="visually-hidden">
          {t("setup.free.heading")}
        </h2>
        <ul className="free-explainer__list">
          <li className="free-explainer__row">
            <span className="free-explainer__glyph" aria-hidden="true">
              <StopwatchIcon />
            </span>
            <span className="free-explainer__text">
              <span className="free-explainer__title">{t("setup.free.timer.title")}</span>
              <span className="free-explainer__body">
                {t("setup.free.timer.body", {
                  slot: slotMinutes(meeting),
                  start: meeting.start,
                  end: meeting.end,
                })}
              </span>
            </span>
          </li>
          <li className="free-explainer__row">
            <span className="free-explainer__glyph" aria-hidden="true">
              <HalfIcon />
            </span>
            <span className="free-explainer__text">
              <span className="free-explainer__title">{t("setup.free.half.title")}</span>
              <span className="free-explainer__body">{t("setup.free.half.body")}</span>
            </span>
          </li>
          <li className="free-explainer__row">
            <span className="free-explainer__glyph" aria-hidden="true">
              <PlusIcon />
            </span>
            <span className="free-explainer__text">
              <span className="free-explainer__title">{t("setup.free.topics.title")}</span>
              <span className="free-explainer__body">{t("setup.free.topics.body")}</span>
            </span>
          </li>
        </ul>
      </section>
      {kept > 0 ? (
        <p className="free-kept" data-testid="free-kept">
          {tp("setup.free.kept", kept)}
        </p>
      ) : null}
    </>
  );
}
