import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { TopBar } from "../../app/TopBar";
import { LOCALES, useI18n, type Locale, type MessageKey } from "../../i18n";
import {
  listSpeakerModels,
  listSpeechModels,
  type ModelList,
  type RecordReason,
  type SpeakerModelList,
  type ThemeSetting,
} from "../../lib/ipc";
import { GearIcon, MicIcon, MonitorIcon, PlayIcon, StopIcon, WaveIcon } from "../../ui/icons";
import { formatMegabytes } from "../transcript/format";
import { LevelMeter } from "../transcript/LevelMeter";
import { RecordingControls } from "../transcript/RecordingControls";
import { THEMES } from "./theme";
import { useCapture, useInputDevices, useMicTest } from "./useAudioState";
import { useSettings } from "./useSettings";

export const SETTINGS_VIEW = "settings";

/** Sections in their order. Later jobs add theirs here (language model, export, AI voice). */
export const SECTIONS = ["audio", "device", "general"] as const;
export type Section = (typeof SECTIONS)[number];

const SECTION_ICONS: Record<Section, () => ReactNode> = {
  audio: MicIcon,
  device: MonitorIcon,
  general: GearIcon,
};

interface Props {
  /** The view it was opened from: "Back" returns there. */
  origin: "setup" | "live";
  meetingTitle?: string;
  onBack: () => void;
  initialSection?: Section;
}

/**
 * Frame 14 "Settings": in the same window, not modal. Sections on the left (tabs on top when narrow),
 * one section's cards on the right. Every change goes to the core at once; there is no "Save". The
 * REC chip stays in the top bar, and recording carries on while the settings are open.
 */
export function SettingsView({ origin, meetingTitle, onBack, initialSection = "audio" }: Props) {
  const { t } = useI18n();
  const { notSaved, status } = useSettings();
  const capture = useCapture();
  const [section, setSection] = useState<Section>(initialSection);
  const ids = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      // An open native select handles Escape itself.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = SECTIONS.indexOf(section);
    const next =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? SECTIONS[(i + 1) % SECTIONS.length]
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? SECTIONS[(i + SECTIONS.length - 1) % SECTIONS.length]
          : e.key === "Home"
            ? SECTIONS[0]
            : e.key === "End"
              ? SECTIONS[SECTIONS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    setSection(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="settings-view">
      <TopBar
        meetingTitle={meetingTitle ?? ""}
        actions={<RecordingControls capture={capture} />}
        onOpenSettings={() => tabRefs.current[section]?.focus()}
        settingsOpen
        onBack={onBack}
        backLabel={origin === "live" ? t("settings.backToMeeting") : t("settings.backToSetup")}
      />
      <main className="settings" id="settings-main" data-view={SETTINGS_VIEW}>
        <div className="settings__nav">
          <h1 className="settings__title">{t("settings.title")}</h1>
          <p className="settings__intro">{t("settings.intro")}</p>
          <div className="settings__tabs" role="tablist" aria-label={t("settings.sections")}>
            {SECTIONS.map((s) => {
              const Icon = SECTION_ICONS[s];
              const on = s === section;
              return (
                <button
                  key={s}
                  ref={(el) => {
                    tabRefs.current[s] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${s}`}
                  aria-controls={`${ids}-panel`}
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  className="settings-tab"
                  onClick={() => setSection(s)}
                  onKeyDown={onTabKey}
                >
                  <span className="settings-tab__icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="settings-tab__text">
                    <span className="settings-tab__label">{t(`settings.section.${s}` as MessageKey)}</span>
                    <span className="settings-tab__sub">{t(`settings.section.${s}.sub` as MessageKey)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div
          className="settings__panel"
          role="tabpanel"
          id={`${ids}-panel`}
          aria-labelledby={`${ids}-tab-${section}`}
        >
          {notSaved || status === "locked" ? (
            <p className="banner banner--warn" role="status">
              {t(status === "locked" ? "settings.locked" : "settings.notSaved")}
            </p>
          ) : null}
          {section === "audio" ? <AudioSection /> : null}
          {section === "device" ? <DeviceSection /> : null}
          {section === "general" ? <GeneralSection /> : null}
        </div>
      </main>
    </div>
  );
}

// ---- shared pieces ------------------------------------------------------------------------------

function Card({
  title,
  hint,
  aside,
  children,
}: {
  title: string;
  hint?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="settings-card" aria-labelledby={id}>
      <div className="settings-card__head">
        <div className="settings-card__heading">
          <h2 className="settings-card__title" id={id}>
            {title}
          </h2>
          {hint ? <p className="settings-card__hint">{hint}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Label left, control right (wide); stacked (narrow). */
function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        {htmlFor ? (
          <label className="settings-row__name" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <p className="settings-row__name">{label}</p>
        )}
        {hint ? <p className="settings-row__hint">{hint}</p> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  lang?: string;
  extra?: ReactNode;
  preview?: ReactNode;
}

/** A labelled radio group of cards. */
function Choices<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  layout = "row",
  visibleLegend = false,
}: {
  legend: string;
  name: string;
  value: T | null;
  options: ChoiceOption<T>[];
  onChange: (v: T) => void;
  layout?: "row" | "column";
  visibleLegend?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className={`choices choices--${layout}`}>
      <legend className={visibleLegend ? "choices__legend" : "visually-hidden"}>{legend}</legend>
      {options.map((o, i) => (
        <label key={o.value} className={`choice${o.value === value ? " choice--on" : ""}`} lang={o.lang}>
          {o.preview}
          <span className="choice__main">
            <input
              type="radio"
              className="choice__radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              aria-labelledby={`${id}-${i}-label`}
              aria-describedby={`${id}-${i}-hint`}
            />
            <span className="choice__text">
              <span className="choice__label" id={`${id}-${i}-label`}>
                {o.label}
              </span>
              <span className="choice__details" id={`${id}-${i}-hint`}>
                {o.hint ? <span className="choice__hint">{o.hint}</span> : null}
                {o.extra}
              </span>
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "info" | "error" | "warn";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`settings-notice settings-notice--${tone}`} role={tone === "info" ? undefined : "status"}>
      {/* The glyph comes from CSS; the title carries the meaning. */}
      <span className="settings-notice__icon" aria-hidden="true" />
      <div className="settings-notice__text">
        <p className="settings-notice__title">{title}</p>
        {children ? <p className="settings-notice__body">{children}</p> : null}
      </div>
    </div>
  );
}

const REASON_KEYS: Record<RecordReason, MessageKey> = {
  noMicrophone: "recording.error.noMicrophone",
  chosenMicrophoneMissing: "recording.error.chosenMicrophoneMissing",
  microphoneBlocked: "recording.error.microphoneBlocked",
  microphoneLost: "recording.error.microphoneLost",
  noModel: "recording.error.noModel",
  engineFailed: "recording.error.engineFailed",
  storageFailed: "recording.error.storageFailed",
  transcriptUnreadable: "recording.error.transcriptUnreadable",
  locked: "recording.error.locked",
};

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---- Audio --------------------------------------------------------------------------------------

const SYSTEM_DEFAULT = "";

function AudioSection() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const capture = useCapture();
  const devices = useInputDevices();
  const test = useMicTest();
  const selectId = useId();
  const chosen = settings.inputDevice;
  const meetingActive = capture.state === "recording" || capture.state === "paused";
  const missing = chosen !== null && devices !== null && !devices.includes(chosen);
  const running = test.state.state === "running";
  const deviceName = chosen ?? t("settings.audio.systemDefault");

  const deviceStatus = missing
    ? t("settings.audio.notConnected")
    : meetingActive
      ? t("settings.audio.inUse")
      : t("settings.audio.connected");

  // A test that is running while a meeting starts ends there; the meter then shows the meeting.
  const testDisabledReason = meetingActive
    ? t("settings.test.disabledRecording")
    : missing
      ? t("settings.test.disabledMissing", { name: chosen ?? "" })
      : null;

  const level = meetingActive ? capture.level : test.state.level;
  const meterActive = capture.state === "recording" || running;
  const testError = test.state.state === "error" && test.state.reason ? test.state.reason : null;

  return (
    <>
      <Card title={t("settings.audio.mic.title")} hint={t("settings.audio.mic.hint")}>
        <Row label={t("settings.audio.device")} hint={t("settings.audio.device.hint")} htmlFor={selectId}>
          <div className={`device-select${missing ? " device-select--missing" : ""}`}>
            <span className="device-select__icon" aria-hidden="true">
              <MicIcon />
            </span>
            <select
              id={selectId}
              className="device-select__select"
              value={chosen ?? SYSTEM_DEFAULT}
              aria-describedby={`${selectId}-status`}
              onChange={(e) => {
                void test.stop();
                void update({
                  key: "inputDevice",
                  value: e.target.value === SYSTEM_DEFAULT ? null : e.target.value,
                });
              }}
            >
              <option value={SYSTEM_DEFAULT}>{t("settings.audio.systemDefault")}</option>
              {(devices ?? []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              {missing && chosen ? (
                <option value={chosen}>{t("settings.audio.optionMissing", { name: chosen })}</option>
              ) : null}
            </select>
            <span className="device-select__status" id={`${selectId}-status`}>
              {deviceStatus}
            </span>
          </div>
          {missing && chosen ? (
            <>
              <Notice tone="error" title={t("settings.audio.missing.title", { name: chosen })}>
                {t("settings.audio.missing.body")}
              </Notice>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void update({ key: "inputDevice", value: null })}
                >
                  {t("recording.missing.useDefault")}
                </button>
              </div>
            </>
          ) : null}
          {meetingActive ? <Notice tone="info" title={t("settings.audio.nextStart")} /> : null}
        </Row>
      </Card>

      <Card
        title={t("settings.test.title")}
        hint={t("settings.test.hint")}
        aside={
          running ? (
            <span className="status-chip" data-testid="mic-test-running">
              <span className="status-chip__dot" aria-hidden="true" />
              {t("settings.test.running")}
            </span>
          ) : null
        }
      >
        <Row
          label={t("settings.test.level")}
          hint={
            meetingActive
              ? t("settings.test.level.recording")
              : running
                ? t("settings.test.level.running")
                : t("settings.test.level.idle")
          }
        >
          <div className="meter-box" data-testid="settings-meter">
            <LevelMeter level={level} active={meterActive} />
            <span className="meter-box__text">
              {meetingActive
                ? t("settings.test.recordingDevice", { name: deviceName })
                : running
                  ? deviceName
                  : t("settings.test.none")}
            </span>
            {running ? (
              <span className="meter-box__left" aria-live="off">
                {t("settings.test.left", { time: formatCountdown(test.state.remainingMs) })}
              </span>
            ) : null}
          </div>
          {running ? (
            <div
              className="test-progress"
              role="progressbar"
              aria-label={t("settings.test.running")}
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={Math.round((10_000 - test.state.remainingMs) / 1000)}
            >
              <span
                className="test-progress__bar"
                style={{ width: `${Math.min(100, ((10_000 - test.state.remainingMs) / 10_000) * 100)}%` }}
              />
            </div>
          ) : null}
          <div className="settings-actions">
            {running ? (
              <button type="button" className="button button--outline" onClick={() => void test.stop()}>
                <StopIcon />
                {t("settings.test.stop")}
              </button>
            ) : (
              <button
                type="button"
                className="button button--outline"
                disabled={testDisabledReason !== null || test.busy}
                aria-describedby={testDisabledReason ? `${selectId}-test-reason` : undefined}
                onClick={() => void test.start()}
              >
                <PlayIcon />
                {t("settings.test.start")}
              </button>
            )}
            <span className="settings-actions__hint" id={`${selectId}-test-reason`}>
              {running ? t("settings.test.stopsItself") : testDisabledReason}
            </span>
          </div>
          {testError ? (
            <p className="banner banner--error" role="alert">
              {t(REASON_KEYS[testError])}
            </p>
          ) : null}
        </Row>
      </Card>

      <Card title={t("settings.lost.title")}>
        <Choices
          legend={t("settings.lost.title")}
          name="device-lost"
          value={settings.deviceLost}
          onChange={(v) => void update({ key: "deviceLost", value: v })}
          options={[
            { value: "stop", label: t("settings.lost.stop"), hint: t("settings.lost.stop.hint") },
            {
              value: "switchToDefault",
              label: t("settings.lost.switch"),
              hint: t("settings.lost.switch.hint"),
            },
          ]}
        />
      </Card>
    </>
  );
}

// ---- On this device -----------------------------------------------------------------------------

const GONE = "__gone__";

/**
 * Frame 14d "Speaker model": the sherpa-onnx speaker models the core found on this device (the
 * smallest is preferred), the chosen one, "None found" with the folders searched, or "Not found any
 * more" when the chosen file was moved or deleted (recording then uses the preferred one).
 */
function SpeakerModelCard() {
  const { t, locale } = useI18n();
  const { settings, update } = useSettings();
  const [models, setModels] = useState<SpeakerModelList | null>(null);
  const selectId = useId();

  useEffect(() => {
    let cancelled = false;
    void listSpeakerModels().then((m) => {
      if (!cancelled) setModels(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = models?.models ?? [];
  const chosen = settings.speakerModel;
  const gone = models !== null && chosen !== null && !list.some((m) => m.id === chosen);
  const inUse = list.find((m) => m.id === chosen) ?? list[0] ?? null;
  const chosenName = chosen ? (chosen.split(/[\\/]/).pop() ?? chosen) : "";
  const describe = (m: (typeof list)[number]) =>
    t("settings.speaker.meta", {
      size: t("model.size", { mb: formatMegabytes(m.sizeBytes, locale) }),
      source: t(`model.source.${m.source}` as MessageKey),
    });

  return (
    <Card title={t("settings.speaker.title")} hint={t("settings.speaker.hint")}>
      <Row label={t("settings.speaker.label")} hint={t("settings.nextStart")} htmlFor={selectId}>
        {models === null ? null : list.length === 0 ? (
          <div className="none-found" data-testid="no-speaker-model">
            <p className="none-found__title">{t("settings.speaker.none.title")}</p>
            <p className="none-found__body">{t("settings.speaker.none.body")}</p>
            <ul className="none-found__folders">
              {models.searched.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className={`device-select${gone ? " device-select--missing" : ""}`}>
              <span className="device-select__icon" aria-hidden="true">
                <WaveIcon />
              </span>
              <select
                id={selectId}
                className="device-select__select"
                value={gone ? GONE : (inUse?.id ?? "")}
                aria-describedby={`${selectId}-status`}
                onChange={(e) => {
                  if (e.target.value !== GONE) void update({ key: "speakerModel", value: e.target.value });
                }}
              >
                {gone ? (
                  <option value={GONE} disabled>
                    {t("settings.speaker.goneOption", { name: chosenName })}
                  </option>
                ) : null}
                {list.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <span className="device-select__status" id={`${selectId}-status`}>
                {gone ? t("settings.speaker.gone") : inUse ? describe(inUse) : null}
              </span>
            </div>
            {gone && inUse ? (
              <Notice tone="warn" title={t("settings.speaker.gone.title")}>
                {t("settings.speaker.gone.body", { name: inUse.name, meta: describe(inUse) })}
              </Notice>
            ) : null}
          </>
        )}
      </Row>
    </Card>
  );
}

function DeviceSection() {
  const { t, locale } = useI18n();
  const { settings, update, storageFolder } = useSettings();
  const [models, setModels] = useState<ModelList | null>(null);
  const pathId = useId();

  useEffect(() => {
    let cancelled = false;
    void listSpeechModels().then((m) => {
      if (!cancelled) setModels(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = models?.models ?? [];
  const chosen = settings.speechModel;
  const gone = models !== null && chosen !== null && !list.some((m) => m.id === chosen);
  // What recording uses: the chosen model, or the preferred one when none is chosen or it is gone.
  const inUse = list.find((m) => m.id === chosen) ?? list[0] ?? null;
  const chosenName = chosen ? (chosen.split(/[\\/]/).pop() ?? chosen) : "";

  const modelHint = (m: (typeof list)[number]) =>
    t("settings.model.meta", {
      size: t("model.size", { mb: formatMegabytes(m.sizeBytes, locale) }),
      language: m.multilingual ? t("model.multilingual") : t("model.englishOnly"),
      source: t(`model.source.${m.source}` as MessageKey),
    });

  return (
    <>
      <Card title={t("settings.model.title")} hint={t("settings.model.hint")}>
        <Row label={t("settings.model.label")} hint={t("settings.nextStart")}>
          {models === null ? null : list.length === 0 ? (
            <div className="none-found" data-testid="no-model">
              <p className="none-found__title">{t("model.none.title")}</p>
              <p className="none-found__body">{t("model.none.body")}</p>
              <ul className="none-found__folders">
                {models.searched.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {gone && inUse ? (
                <Notice tone="warn" title={t("settings.model.gone.title", { name: chosenName })}>
                  {t("settings.model.gone.body", { name: inUse.name })}
                </Notice>
              ) : null}
              <Choices
                legend={t("settings.model.label")}
                name="speech-model"
                layout="column"
                value={gone ? null : (inUse?.id ?? null)}
                onChange={(v) => void update({ key: "speechModel", value: v })}
                options={list.map((m) => ({
                  value: m.id,
                  label: m.name,
                  hint: modelHint(m),
                  extra: (
                    <>
                      {m.folder ? (
                        <span className="choice__hint choice__path">
                          {t("model.foundIn", { folder: m.folder })}
                        </span>
                      ) : null}
                      {!m.multilingual ? (
                        <span className="choice__warn">
                          <span className="choice__warn-tag">{t("settings.model.enOnly")}</span>
                          {t("model.englishOnlyHint")}
                        </span>
                      ) : null}
                    </>
                  ),
                }))}
              />
            </>
          )}
        </Row>
      </Card>

      <SpeakerModelCard />

      <Card
        title={t("settings.language.title")}
        hint={t("settings.language.hint")}
        aside={
          <span className="device-chip">
            {t(`recording.onDevice.${settings.meetingLanguage}` as MessageKey)}
          </span>
        }
      >
        <Choices
          legend={t("settings.language.title")}
          name="meeting-language"
          value={settings.meetingLanguage}
          onChange={(v) => void update({ key: "meetingLanguage", value: v })}
          options={[
            { value: "auto", label: t("settings.language.auto"), hint: t("settings.language.auto.hint") },
            { value: "de", label: t("settings.language.de"), hint: t("settings.language.de.hint") },
            { value: "en", label: t("settings.language.en"), hint: t("settings.language.en.hint") },
          ]}
        />
      </Card>

      <Card title={t("settings.storage.title")}>
        <Row label={t("settings.storage.label")} hint={t("settings.storage.hint")} htmlFor={pathId}>
          <input
            id={pathId}
            className="settings-path"
            type="text"
            readOnly
            value={storageFolder}
            onFocus={(e) => e.target.select()}
          />
        </Row>
      </Card>
    </>
  );
}

// ---- General ------------------------------------------------------------------------------------

function ThemePreview({ mode }: { mode: ThemeSetting }) {
  const halves = mode === "system" ? ["light", "dark"] : [mode];
  return (
    <span className="theme-preview" aria-hidden="true">
      {halves.map((h) => (
        <span key={h} className={`theme-preview__half theme-preview__half--${h}`}>
          <span className="theme-preview__line" />
          <span className="theme-preview__card">
            <span className="theme-preview__accent" />
            <span className="theme-preview__muted" />
          </span>
        </span>
      ))}
    </span>
  );
}

function GeneralSection() {
  const { t } = useI18n();
  const { settings, update, systemDark } = useSettings();
  return (
    <>
      <Card title={t("settings.app.title")} hint={t("settings.app.hint")}>
        <Choices
          legend={t("settings.app.title")}
          name="app-language"
          value={settings.locale}
          onChange={(v) => void update({ key: "locale", value: v })}
          options={LOCALES.map((l: Locale) => ({
            value: l,
            lang: l,
            label: t(`language.${l}` as MessageKey),
            hint: t(`settings.app.${l}.hint` as MessageKey),
          }))}
        />
      </Card>
      <Card title={t("settings.theme.title")}>
        <Choices
          legend={t("settings.theme.title")}
          name="theme"
          value={settings.theme}
          onChange={(v) => void update({ key: "theme", value: v })}
          options={THEMES.map((m) => ({
            value: m,
            label: t(`settings.theme.${m}` as MessageKey),
            hint:
              m === "system"
                ? t("settings.theme.system.hint", {
                    now: systemDark ? t("settings.theme.nowDark") : t("settings.theme.nowLight"),
                  })
                : t(`settings.theme.${m}.hint` as MessageKey),
            preview: <ThemePreview mode={m} />,
          }))}
        />
      </Card>
    </>
  );
}
