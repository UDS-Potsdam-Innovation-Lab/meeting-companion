// The right column of frames 02/16 (job 018): kind tabs, the list, the Undo notice and the composer.
// The parts live in their own modules; this one puts the column together.
import type { ReactNode, RefObject } from "react";
import { useI18n } from "../../i18n";
import type { CaptureType } from "../../lib/ipc";
import { CAPTURE_KINDS } from "../../lib/ipc";
import { CaptureList } from "./CaptureList";
import { Composer, type ComposerProps } from "./Composer";
import { TAB_KEYS } from "./labels";
import { countByKind, type KindCounts } from "./model";
import { UndoNotice } from "./UndoNotice";

export { CaptureList } from "./CaptureList";
export { Composer } from "./Composer";
export { errorText, formatDue, savedAnnouncement, targetShort } from "./labels";
export { UndoNotice } from "./UndoNotice";

// ---- kind tabs ---------------------------------------------------------------------------------------

/** "Decisions 1 / To-dos 2 / Questions 0": the open tab is also the composer's kind. */
export function CaptureTabs({
  counts,
  kind,
  onKind,
  suggested,
}: {
  counts: KindCounts;
  kind: CaptureType;
  onKind: (k: CaptureType) => void;
  /** Kinds with a suggestion waiting: a dot on the tab (job 019). */
  suggested?: ReadonlySet<CaptureType>;
}) {
  const { t, tp } = useI18n();
  return (
    <div className="capture-tabs" role="group" aria-label={t("captures.tabs.label")}>
      {CAPTURE_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className="capture-tabs__tab"
          aria-pressed={k === kind}
          data-kind={k}
          onClick={() => onKind(k)}
        >
          <span className="capture-tabs__name">{t(TAB_KEYS[k])}</span>
          <span className="capture-tabs__count" aria-hidden="true">
            {counts[k]}
          </span>
          <span className="visually-hidden">{tp("captures.tab.count", counts[k])}</span>
          {suggested?.has(k) ? (
            <span className="capture-tabs__dot" data-testid={`suggest-dot-${k}`}>
              <span className="visually-hidden">{t("captures.suggest.pendingTab")}</span>
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// ---- the column -------------------------------------------------------------------------------------------

export interface CapturesColumnProps extends ComposerProps {
  /** Focus target after a delete or when the notice goes: the composer field. */
  composerRef: RefObject<HTMLTextAreaElement | null>;
  /** The pinned suggestion of the open tab (job 019). */
  pin?: ReactNode;
  /** The status line under the composer (job 019). */
  status?: ReactNode;
  suggested?: ReadonlySet<CaptureType>;
}

/** Frame 02/16 right column: tabs with counts, the cards, the Undo notice and the composer, pinned. */
export function CapturesColumn(props: CapturesColumnProps) {
  const { t } = useI18n();
  const { meeting, captures, kind, onKind, target, composerRef, pin, status, suggested } = props;
  const focusComposer = () => composerRef.current?.focus();
  return (
    <section className="captures-column" aria-labelledby="captures-heading" data-testid="captures-column">
      <h2 id="captures-heading" className="visually-hidden">
        {t("captures.heading")}
      </h2>
      <CaptureTabs
        counts={countByKind(captures.captures)}
        kind={kind}
        onKind={onKind}
        suggested={suggested}
      />
      {captures.loadFailed ? (
        <p className="banner banner--error" role="alert">
          {t("captures.loadFailed")}
        </p>
      ) : null}
      <CaptureList
        meeting={meeting}
        captures={captures}
        kind={kind}
        target={target}
        onDeleted={focusComposer}
        top={pin}
      />
      <div className="captures-column__bottom">
        <UndoNotice meeting={meeting} captures={captures} onGone={focusComposer} />
        <Composer
          ref={composerRef}
          meeting={meeting}
          captures={captures}
          kind={kind}
          onKind={onKind}
          target={target}
        />
        {status}
      </div>
    </section>
  );
}
