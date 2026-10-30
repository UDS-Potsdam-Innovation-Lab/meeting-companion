import { forwardRef, useId, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import type { SpeakerParticipant, TranscriptSegment, VoiceLabel } from "../../lib/ipc";
import { Avatar, avatarColor } from "../../ui/Avatar";
import { ArrowRightIcon, ChevronDownIcon, PlusIcon, WaveIcon } from "../../ui/icons";
import { GuestForm } from "./GuestForm";
import {
  matchedCount,
  NAME_ROUND_MS,
  shorten,
  voiceStatus,
  voiceSummaries,
  type VoiceStatus,
  type VoiceSummary,
} from "./model";
import type { Speakers } from "./useSpeakers";

export const SPEAKERS_VIEW = "speakers";

interface Props {
  lines: TranscriptSegment[];
  speakers: Speakers;
}

const firstName = (p: SpeakerParticipant) => p.name.trim().split(/\s+/)[0] ?? p.name;

/**
 * Frame 06 "Speakers", inside the live meeting (not a modal; recording goes on): one row per voice
 * with its talk time, first line and a person picker; who spoke when; the invited people with their
 * voices; how names are found; and "Apply names to transcript". Suggestions from the name round show
 * as suggestions until a person confirms them. Transcript text and names are rendered as text only.
 */
export const SpeakersView = forwardRef<HTMLHeadingElement, Props>(function SpeakersView(
  { lines, speakers },
  ref,
) {
  const { t, tp } = useI18n();
  const voices = voiceSummaries(lines);
  const { state, models } = speakers;
  const labels = voices.map((v) => v.voice);
  const noModel = models !== null && models.models.length === 0;
  const total = Math.max(1, ...lines.filter((l) => l.final).map((l) => l.endMs));
  const applicable = labels.some((v) => voiceStatus(state, v).kind === "suggested");

  return (
    <main className="speakers" id="main" data-view={SPEAKERS_VIEW}>
      <div className="speakers__main">
        <header className="speakers__header">
          <p className="speakers__eyebrow">{t("speakers.eyebrow")}</p>
          <h1 className="speakers__title" ref={ref} tabIndex={-1}>
            {voices.length === 0
              ? t("speakers.title.empty")
              : tp("speakers.title", voices.length, { matched: matchedCount(state, labels) })}
          </h1>
          <p className="speakers__subtitle">{t("speakers.subtitle")}</p>
        </header>
        {speakers.failed ? (
          <p className="banner banner--error" role="alert">
            {t("speakers.failed")}
          </p>
        ) : null}
        {noModel ? (
          <div className="speakers__no-model">
            <p className="speakers__no-model-title">{t("speakers.noModel.title")}</p>
            <p className="speakers__no-model-body">{t("speakers.noModel.body")}</p>
            <ul className="speakers__folders">
              {models.searched.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <section className="speakers-card" aria-label={t("speakers.voices.heading")}>
          {voices.length === 0 ? (
            <p className="speakers-card__empty">{t("speakers.empty")}</p>
          ) : (
            <ul className="voice-rows">
              {voices.map((v) => (
                <VoiceRow key={v.voice} summary={v} speakers={speakers} />
              ))}
            </ul>
          )}
        </section>
        {voices.length > 0 ? <Timeline voices={voices} speakers={speakers} total={total} /> : null}
      </div>
      <aside className="speakers__side">
        <Invited speakers={speakers} labels={labels} />
        <section className="speakers-how" aria-labelledby="speakers-how-heading">
          <h2 className="speakers-how__heading" id="speakers-how-heading">
            {t("speakers.how.heading")}
          </h2>
          <ol className="speakers-how__list">
            <li>{t("speakers.how.nameRound")}</li>
            <li>{t("speakers.how.remote")}</li>
            <li>{t("speakers.how.confirm")}</li>
          </ol>
        </section>
        <button
          type="button"
          className="button button--primary speakers__apply"
          aria-disabled={!applicable}
          onClick={() => {
            if (applicable) void speakers.applyNames();
          }}
        >
          {t("speakers.apply")}
        </button>
      </aside>
    </main>
  );
});

function VoiceRow({ summary, speakers }: { summary: VoiceSummary; speakers: Speakers }) {
  const { t } = useI18n();
  const status = voiceStatus(speakers.state, summary.voice);
  const unsure = status.kind === "unsure";
  return (
    <li className={`voice-row${unsure ? " voice-row--unsure" : ""}`}>
      <div className="voice-row__who">
        <p className="voice-row__line">
          <span className="voice-row__label">{t("speakers.voice", { voice: summary.voice })}</span>
          <span className="voice-row__wave">
            <WaveIcon />
          </span>
          <span className="voice-row__share">{t("speakers.talkTime", { percent: summary.share })}</span>
        </p>
        <p className="voice-row__quote">{t("speakers.quote", { text: shorten(summary.firstText) })}</p>
      </div>
      <span className="voice-row__arrow">
        <ArrowRightIcon />
      </span>
      <VoicePicker voice={summary.voice} status={status} speakers={speakers} />
    </li>
  );
}

const NONE = "__none__";
const GUEST = "__guest__";
const PENDING = "";

function VoicePicker({
  voice,
  status,
  speakers,
}: {
  voice: VoiceLabel;
  status: VoiceStatus;
  speakers: Speakers;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const [guest, setGuest] = useState(false);
  const names = (people: SpeakerParticipant[]) =>
    new Intl.ListFormat(locale, { type: "disjunction" }).format(people.map(firstName));
  const value =
    status.kind === "confirmed"
      ? status.person.id
      : status.kind === "unassigned" && status.chosen
        ? NONE
        : PENDING;
  const pendingText =
    status.kind === "suggested"
      ? t("speakers.suggested.option", { name: status.person.name })
      : status.kind === "unsure"
        ? t("speakers.unsure.option", { names: names(status.candidates) })
        : t("speakers.unassigned.option");

  const face = (() => {
    switch (status.kind) {
      case "confirmed":
        return {
          avatar: status.person.name,
          title: status.person.name,
          sub: t(`speakers.source.${status.source}` as MessageKey),
        };
      case "suggested":
        return {
          avatar: status.person.name,
          title: status.person.name,
          sub: t("speakers.suggested.sub"),
        };
      case "unsure":
        return {
          avatar: status.candidates[0]!.name,
          title: t("speakers.unsure.name", { name: status.candidates[0]!.name }),
          sub: t("speakers.unsure.which", { names: names(status.candidates) }),
        };
      case "unassigned":
        return status.chosen
          ? { avatar: null, title: t("speakers.unassigned"), sub: t("speakers.source.manual") }
          : { avatar: null, title: t("speakers.addGuest"), sub: t("speakers.notInvited") };
    }
  })();

  return (
    <div className="voice-picker-wrap">
      <div className={`voice-picker voice-picker--${status.kind}`}>
        <span className="voice-picker__face" aria-hidden="true">
          {face.avatar ? (
            <Avatar name={face.avatar} size={28} />
          ) : (
            <span className="voice-picker__plus">
              <PlusIcon />
            </span>
          )}
          <span className="voice-picker__text">
            <span className="voice-picker__title">{face.title}</span>
            <span className="voice-picker__sub">{face.sub}</span>
          </span>
          <span className="voice-picker__chevron">
            <ChevronDownIcon />
          </span>
        </span>
        <select
          id={id}
          className="voice-picker__select"
          aria-label={t("speakers.picker.label", { voice })}
          value={guest ? GUEST : value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === GUEST) return setGuest(true);
            setGuest(false);
            if (v === PENDING) return;
            void speakers.chooseVoice(voice, v === NONE ? null : v);
          }}
        >
          {value === PENDING ? (
            <option value={PENDING} disabled>
              {pendingText}
            </option>
          ) : null}
          {speakers.state.participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={GUEST}>{t("speakers.addGuest")}</option>
          <option value={NONE}>{t("speakers.unassigned")}</option>
        </select>
      </div>
      {guest ? (
        <GuestForm
          onCancel={() => {
            setGuest(false);
            document.getElementById(id)?.focus();
          }}
          onAdd={async (name) => {
            const participantId = await speakers.addGuest(name);
            await speakers.chooseVoice(voice, participantId);
            setGuest(false);
            document.getElementById(id)?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function Timeline({
  voices,
  speakers,
  total,
}: {
  voices: VoiceSummary[];
  speakers: Speakers;
  total: number;
}) {
  const { t, tp } = useI18n();
  const round = Math.min(100, (NAME_ROUND_MS / total) * 100);
  return (
    <section className="speakers-card timeline" aria-labelledby="timeline-heading">
      <div className="timeline__header">
        <h2 className="timeline__heading" id="timeline-heading">
          {t("speakers.timeline.heading")}
        </h2>
        <span className="timeline__note">{t("speakers.timeline.nameRound")}</span>
      </div>
      <ul className="timeline__tracks">
        {voices.map((v) => {
          const status = voiceStatus(speakers.state, v.voice);
          const color = status.kind === "confirmed" ? avatarColor(status.person.name) : undefined;
          return (
            <li key={v.voice} className="timeline__row">
              <span className="timeline__label" aria-hidden="true">
                {t("speakers.voice", { voice: v.voice })}
              </span>
              <span
                className="timeline__track"
                role="img"
                aria-label={tp("speakers.timeline.track", v.spans.length, { voice: v.voice })}
              >
                <span className="timeline__round" style={{ width: `${round}%` }} />
                {v.spans.map((s, i) => (
                  <span
                    key={i}
                    className={`timeline__bar${color ? "" : " timeline__bar--open"}`}
                    style={{
                      left: `${(s.startMs / total) * 100}%`,
                      width: `max(3px, ${((s.endMs - s.startMs) / total) * 100}%)`,
                      ...(color ? { background: color } : {}),
                    }}
                  />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Invited({ speakers, labels }: { speakers: Speakers; labels: VoiceLabel[] }) {
  const { t } = useI18n();
  const invited = speakers.state.participants.filter((p) => !p.guest);
  const statuses = labels.map((v) => ({ voice: v, status: voiceStatus(speakers.state, v) }));
  return (
    <section className="speakers-card invited" aria-labelledby="invited-heading">
      <h2 className="invited__heading" id="invited-heading">
        {t("speakers.invited.heading", { count: invited.length })}
      </h2>
      <ul className="invited__list">
        {invited.map((p) => {
          const confirmed = statuses.filter(
            (s) => s.status.kind === "confirmed" && s.status.person.id === p.id,
          );
          const open = statuses.filter(
            (s) =>
              (s.status.kind === "suggested" && s.status.person.id === p.id) ||
              (s.status.kind === "unsure" && s.status.candidates.some((c) => c.id === p.id)),
          );
          return (
            <li key={p.id} className="invited__row">
              <Avatar name={p.name} size={30} />
              <span className="invited__name">{p.name}</span>
              <span className="invited__chips">
                {confirmed.map((s) => (
                  <span key={s.voice} className="voice-chip">
                    {t("speakers.invited.voice", { voice: s.voice })}
                  </span>
                ))}
                {open.map((s) => (
                  <span
                    key={s.voice}
                    className="voice-chip voice-chip--open"
                    title={t("speakers.invited.unsureLabel", { voice: s.voice })}
                  >
                    <span aria-hidden="true">{t("speakers.invited.unsure", { voice: s.voice })}</span>
                    <span className="visually-hidden">
                      {t("speakers.invited.unsureLabel", { voice: s.voice })}
                    </span>
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
