import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import {
  CLAUDE_MODELS,
  cancelLlmTest,
  deleteApiKey,
  getApiKeyStatus,
  listLlmModels,
  runLlmTest,
  setApiKey,
  type ClaudeModelSetting,
  type LanguageModelSetting,
  type LlmErrorKind,
  type LlmModel,
  type LlmModelList,
  type LlmTestReply,
} from "../../lib/ipc";
import { CheckIcon, CloudIcon, PlayIcon, SparkleIcon, StopIcon } from "../../ui/icons";
import { Card, Choices, Notice, Row } from "./parts";
import { useSettings } from "./useSettings";

type Engine = "none" | "local" | "claude";

const engineOf = (s: LanguageModelSetting): Engine =>
  s === "none" ? "none" : s === "claude" ? "claude" : "local";

const localIdOf = (s: LanguageModelSetting): string | null =>
  typeof s === "object" && s !== null ? s.local : null;

/** `null` while asking the core; `unavailable` when the keychain is locked or missing. */
type KeyState = { set: boolean } | "unavailable" | null;

type TestState =
  | { state: "idle" }
  | { state: "running"; startedAt: number }
  | { state: "reply"; reply: LlmTestReply; engine: string }
  | { state: "error"; kind: LlmErrorKind };

/** File size in gigabytes with one decimal, in the active locale. */
function formatGigabytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    bytes / 1_000_000_000,
  );
}

function formatSeconds(ms: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    ms / 1000,
  );
}

/**
 * Frame 17 "Language model": the engine choice (Off / On this device / Claude API), the local model
 * list, the Claude key and model, and "Test". Choosing Claude first shows an inline confirmation that
 * names the destination; the setting changes only when the person confirms. The key never comes back
 * from the core: the view only learns whether one is saved.
 */
export function LanguageModelSection() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [models, setModels] = useState<LlmModelList | null>(null);
  const [pending, setPending] = useState<"claude" | "local" | null>(null);
  const engine = engineOf(settings.languageModel);

  useEffect(() => {
    let cancelled = false;
    void listLlmModels().then((m) => {
      if (!cancelled) setModels(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A changed engine or model starts a fresh Test card: an earlier result is stale, a running test ends.
  const settingKey = JSON.stringify([settings.languageModel, settings.claudeModel]);

  const localAvailable = models?.available === true;
  const choose = (next: Engine) => {
    if (next === engine) {
      setPending(null);
      return;
    }
    if (next === "none") {
      setPending(null);
      void update({ key: "languageModel", value: "none" });
    } else if (next === "claude") {
      setPending("claude");
    } else {
      // A local model takes effect at once: the first one found, or the person picks one below.
      const first = models?.models[0];
      if (first) {
        setPending(null);
        void update({ key: "languageModel", value: { local: first.id } });
      } else {
        setPending("local");
      }
    }
  };

  const cancelClaude = () => {
    setPending(null);
    document.querySelector<HTMLInputElement>('input[name="llm-engine"][value="claude"]')?.focus();
  };

  const showLocal = engine === "local" || pending === "local";
  const showClaude = engine === "claude";

  return (
    <>
      <Card title={t("settings.llm.title")} hint={t("settings.llm.hint")}>
        <Choices<Engine>
          legend={t("settings.llm.engine")}
          name="llm-engine"
          value={engine}
          onChange={choose}
          options={[
            { value: "none", label: t("settings.llm.off"), hint: t("settings.llm.off.hint") },
            {
              value: "local",
              label: t("settings.llm.local"),
              hint:
                localAvailable || models === null
                  ? t("settings.llm.local.hint")
                  : t("settings.llm.local.unavailable"),
              disabled: models !== null && !localAvailable && engine !== "local",
              pending: pending === "local",
              extra:
                pending === "local" ? (
                  <span className="choice__tag">{t("settings.llm.pendingLocal")}</span>
                ) : null,
            },
            {
              value: "claude",
              label: t("settings.llm.claude"),
              hint: t("settings.llm.claude.hint"),
              pending: pending === "claude",
              extra:
                pending === "claude" ? (
                  <span className="choice__tag">{t("settings.llm.pending")}</span>
                ) : null,
            },
          ]}
        />
        {pending === "claude" ? (
          <ClaudeConfirm
            onConfirm={() => {
              setPending(null);
              void update({ key: "languageModel", value: "claude" });
            }}
            onCancel={cancelClaude}
          />
        ) : null}
      </Card>

      {showLocal && models ? (
        <LocalModelCard
          models={models}
          chosen={localIdOf(settings.languageModel)}
          onChoose={(id) => {
            setPending(null);
            void update({ key: "languageModel", value: { local: id } });
          }}
        />
      ) : null}

      {showClaude ? <ClaudeCard /> : null}

      <TestCard key={settingKey} engine={engine} models={models} />
    </>
  );
}

// ---- the cloud confirmation ---------------------------------------------------------------------

function ClaudeConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <section className="llm-confirm" aria-labelledby={titleId} data-testid="llm-confirm">
      <div className="llm-confirm__head">
        <span className="llm-confirm__icon" aria-hidden="true">
          <CloudIcon />
        </span>
        <div>
          <h3 className="llm-confirm__title" id={titleId}>
            {t("settings.llm.confirm.title")}
          </h3>
          <p className="llm-confirm__body">{t("settings.llm.confirm.body")}</p>
        </div>
      </div>
      <dl className="llm-facts">
        <div className="llm-facts__row">
          <dt>{t("settings.llm.confirm.destination")}</dt>
          <dd data-testid="llm-destination">{t("settings.llm.confirm.destinationValue")}</dd>
        </div>
        <div className="llm-facts__row">
          <dt>{t("settings.llm.confirm.what")}</dt>
          <dd>{t("settings.llm.confirm.whatValue")}</dd>
        </div>
        <div className="llm-facts__row">
          <dt>{t("settings.llm.confirm.needs")}</dt>
          <dd>{t("settings.llm.confirm.needsValue")}</dd>
        </div>
      </dl>
      <div className="settings-actions llm-confirm__actions">
        <button type="button" className="button button--primary" onClick={onConfirm}>
          {t("settings.llm.confirm.use")}
        </button>
        <button type="button" className="button button--outline" onClick={onCancel}>
          {t("settings.llm.confirm.cancel")}
        </button>
      </div>
    </section>
  );
}

// ---- On this device -----------------------------------------------------------------------------

function LocalModelCard({
  models,
  chosen,
  onChoose,
}: {
  models: LlmModelList;
  chosen: string | null;
  onChoose: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const list = models.models;
  const gone = chosen !== null && !list.some((m) => m.id === chosen);
  const chosenName = chosen ? (chosen.split(/[\\/]/).pop() ?? chosen) : "";
  const describe = (m: LlmModel) =>
    t("settings.llm.local.meta", {
      size: t("model.sizeGb", { gb: formatGigabytes(m.sizeBytes, locale) }),
      source: t(`model.source.${m.source}` as MessageKey),
    });

  return (
    <Card
      title={t("settings.llm.local.title")}
      hint={t("settings.llm.local.cardHint")}
      aside={
        <span className="llm-chip llm-chip--device">
          <CheckIcon />
          {t("settings.llm.onDevice")}
        </span>
      }
    >
      <Row label={t("settings.llm.local.label")} hint={t("settings.llm.local.labelHint")}>
        {list.length === 0 && !gone ? (
          <div className="none-found" data-testid="no-llm-model">
            <p className="none-found__title">{t("settings.llm.local.none.title")}</p>
            <p className="none-found__body">{t("settings.llm.local.none.body")}</p>
            <ul className="none-found__folders">
              {models.searched.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="none-found__body">{t("settings.llm.local.none.after")}</p>
          </div>
        ) : (
          <>
            {gone ? (
              <>
                <div className="device-select device-select--missing llm-gone" data-testid="llm-model-gone">
                  <span className="device-select__icon" aria-hidden="true">
                    <SparkleIcon />
                  </span>
                  <span className="llm-gone__name">{chosenName}</span>
                  <span className="device-select__status">{t("settings.llm.local.gone")}</span>
                </div>
                <Notice tone="warn" title={t("settings.llm.local.gone.title")}>
                  {t("settings.llm.local.gone.body")}
                </Notice>
              </>
            ) : null}
            {list.length > 0 ? (
              <Choices
                legend={t("settings.llm.local.label")}
                name="llm-local-model"
                layout="column"
                value={gone ? null : chosen}
                onChange={onChoose}
                options={list.map((m) => ({
                  value: m.id,
                  label: m.name,
                  hint: describe(m),
                  extra: m.folder ? (
                    <span className="choice__hint choice__path">
                      {t("model.foundIn", { folder: m.folder })}
                    </span>
                  ) : null,
                }))}
              />
            ) : null}
          </>
        )}
      </Row>
    </Card>
  );
}

// ---- Claude API ---------------------------------------------------------------------------------

function ClaudeCard() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const modelId = useId();
  return (
    <Card
      title={t("settings.llm.claudeCard.title")}
      hint={t("settings.llm.claudeCard.hint")}
      aside={
        <span className="llm-chip llm-chip--cloud">
          <CloudIcon />
          {t("settings.llm.cloud")}
        </span>
      }
    >
      <div className="llm-destination" data-testid="llm-destination-line">
        <span className="llm-destination__icon" aria-hidden="true">
          <CloudIcon />
        </span>
        <div>
          <p className="llm-destination__title">{t("settings.llm.destination.title")}</p>
          <p className="llm-destination__body">{t("settings.llm.destination.body")}</p>
        </div>
      </div>
      <Row label={t("settings.llm.model.label")} hint={t("settings.llm.model.hint")} htmlFor={modelId}>
        <div className="device-select">
          <span className="device-select__icon" aria-hidden="true">
            <SparkleIcon />
          </span>
          <select
            id={modelId}
            className="device-select__select"
            value={settings.claudeModel}
            aria-describedby={`${modelId}-status`}
            onChange={(e) => void update({ key: "claudeModel", value: e.target.value as ClaudeModelSetting })}
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m}>
                {t(`settings.llm.model.${m}` as MessageKey)}
              </option>
            ))}
          </select>
          <span className="device-select__status" id={`${modelId}-status`}>
            {t(`settings.llm.model.${settings.claudeModel}.hint` as MessageKey)}
          </span>
        </div>
      </Row>
      <ApiKeyRow />
    </Card>
  );
}

function ApiKeyRow() {
  const { t } = useI18n();
  const [status, setStatus] = useState<KeyState>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [hasInput, setHasInput] = useState(false);
  const [busy, setBusy] = useState(false);
  // The key stays in the input element only: never in React state, never in storage.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fieldId = useId();

  const refresh = useCallback(() => {
    getApiKeyStatus().then(
      (s) => setStatus(s),
      () => setStatus("unavailable"),
    );
  }, []);
  useEffect(refresh, [refresh]);

  const clearField = () => {
    if (inputRef.current) inputRef.current.value = "";
    setHasInput(false);
  };

  const save = async () => {
    const value = inputRef.current?.value ?? "";
    if (!value.trim()) return;
    setBusy(true);
    try {
      const s = await setApiKey(value);
      clearField();
      setInvalid(false);
      setEditing(false);
      setStatus(s);
    } catch (e) {
      const kind = (e as { kind?: string }).kind;
      if (kind === "invalidKey") setInvalid(true);
      else {
        clearField();
        setStatus("unavailable");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      setStatus(await deleteApiKey());
    } catch {
      setStatus("unavailable");
    } finally {
      setBusy(false);
      setRemoving(false);
    }
  };

  const saved = status !== null && status !== "unavailable" && status.set;
  const showField = status !== null && (!saved || editing);

  return (
    <Row
      label={t("settings.llm.key.label")}
      hint={t("settings.llm.key.hint")}
      htmlFor={showField ? fieldId : undefined}
    >
      {status === null ? null : (
        <div className="llm-key" data-testid="llm-key">
          <div className="llm-key__status">
            {saved ? (
              <span className="llm-chip llm-chip--saved" data-testid="key-status">
                <CheckIcon />
                {t("settings.llm.key.saved")}
              </span>
            ) : (
              <span className="llm-chip llm-chip--none" data-testid="key-status">
                <span className="llm-chip__ring" aria-hidden="true" />
                {t("settings.llm.key.none")}
              </span>
            )}
            <span className="settings-actions__hint">
              {saved
                ? t("settings.llm.key.savedHint")
                : status !== "unavailable"
                  ? t("settings.llm.key.noneHint")
                  : null}
            </span>
          </div>

          {status === "unavailable" ? (
            <>
              <Notice tone="error" title={t("settings.llm.key.unavailable.title")}>
                {t("settings.llm.key.unavailable.body")}
              </Notice>
              <div className="settings-actions">
                <button type="button" className="button button--outline" onClick={refresh}>
                  {t("settings.llm.key.retry")}
                </button>
              </div>
            </>
          ) : null}

          {showField && status !== "unavailable" ? (
            <form
              className="llm-key__form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="llm-key__entry">
                <input
                  ref={inputRef}
                  id={fieldId}
                  className={`llm-key__input${invalid ? " llm-key__input--invalid" : ""}`}
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t("settings.llm.key.placeholder")}
                  aria-label={t("settings.llm.key.field")}
                  aria-invalid={invalid || undefined}
                  aria-describedby={`${fieldId}-hint`}
                  onInput={(e) => {
                    setHasInput((e.target as HTMLInputElement).value.length > 0);
                    setInvalid(false);
                  }}
                />
                <button type="submit" className="button button--primary" disabled={!hasInput || busy}>
                  {t("settings.llm.key.save")}
                </button>
                {saved ? (
                  <button
                    type="button"
                    className="button button--outline"
                    onClick={() => {
                      clearField();
                      setInvalid(false);
                      setEditing(false);
                    }}
                  >
                    {t("settings.llm.key.cancel")}
                  </button>
                ) : null}
              </div>
              {invalid ? (
                <p className="llm-key__error" role="alert" id={`${fieldId}-hint`}>
                  <span className="llm-key__error-icon" aria-hidden="true" />
                  {t("settings.llm.key.invalid")}
                </p>
              ) : (
                <p className="settings-row__hint" id={`${fieldId}-hint`}>
                  {t("settings.llm.key.afterSave")}
                </p>
              )}
            </form>
          ) : null}

          {saved && !editing && !removing ? (
            <div className="settings-actions">
              <button type="button" className="button button--outline" onClick={() => setEditing(true)}>
                {t("settings.llm.key.replace")}
              </button>
              <button type="button" className="button button--danger-soft" onClick={() => setRemoving(true)}>
                {t("settings.llm.key.remove")}
              </button>
            </div>
          ) : null}

          {removing ? (
            <div className="llm-remove" role="group" aria-labelledby={`${fieldId}-remove`}>
              <p className="llm-remove__title" id={`${fieldId}-remove`}>
                {t("settings.llm.key.removeConfirm.title")}
              </p>
              <p className="llm-remove__body">{t("settings.llm.key.removeConfirm.body")}</p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="button button--danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {t("settings.llm.key.remove")}
                </button>
                <button type="button" className="button button--outline" onClick={() => setRemoving(false)}>
                  {t("settings.llm.key.cancel")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Row>
  );
}

// ---- Test ---------------------------------------------------------------------------------------

function TestCard({ engine, models }: { engine: Engine; models: LlmModelList | null }) {
  const { t, locale } = useI18n();
  const { settings } = useSettings();
  const [test, setTest] = useState<TestState>({ state: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const hintId = useId();
  const running = test.state === "running";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);

  // Leaving the section ends a running test: nothing keeps waiting in the background.
  const runningRef = useRef(false);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(
    () => () => {
      if (runningRef.current) void cancelLlmTest();
    },
    [],
  );

  const localId = localIdOf(settings.languageModel);
  const engineName =
    engine === "claude"
      ? t(`settings.llm.model.${settings.claudeModel}` as MessageKey)
      : (models?.models.find((m) => m.id === localId)?.name ?? (localId?.split(/[\\/]/).pop() || ""));

  const start = async () => {
    const startedAt = Date.now();
    setNow(startedAt);
    setTest({ state: "running", startedAt });
    try {
      const reply = await runLlmTest();
      setTest({ state: "reply", reply, engine: engineName });
    } catch (e) {
      setTest({ state: "error", kind: (e as { kind: LlmErrorKind }).kind });
    }
  };

  const off = engine === "none";
  return (
    <Card title={t("settings.llm.test.title")} hint={t("settings.llm.test.hint")}>
      <Row label={t("settings.llm.test.sampleLabel")}>
        <p className="llm-sample">{t("settings.llm.test.sample")}</p>
        <div className="settings-actions">
          {running ? (
            <button type="button" className="button button--outline" onClick={() => void cancelLlmTest()}>
              <StopIcon />
              {t("settings.llm.test.cancel")}
            </button>
          ) : (
            <button
              type="button"
              className="button button--outline"
              disabled={off}
              aria-describedby={off ? hintId : undefined}
              onClick={() => void start()}
            >
              <PlayIcon />
              {test.state === "idle" ? t("settings.llm.test.run") : t("settings.llm.test.again")}
            </button>
          )}
          <span className="settings-actions__hint" id={hintId}>
            {running ? t("settings.llm.test.cancelHint") : off ? t("settings.llm.test.choose") : null}
          </span>
        </div>
        <div aria-live="polite" className="llm-result-region">
          {test.state === "running" ? (
            <div className="llm-waiting" data-testid="llm-waiting">
              <p className="llm-waiting__text">
                {t("settings.llm.test.waiting", {
                  engine: engineName,
                  seconds: String(Math.max(0, Math.floor((now - test.startedAt) / 1000))),
                })}
              </p>
              <span className="llm-waiting__bar" aria-hidden="true" />
            </div>
          ) : null}
          {test.state === "reply" ? (
            <div className="llm-reply" data-testid="llm-reply">
              <p className="llm-reply__head">
                <span className="llm-chip llm-chip--saved">
                  <CheckIcon />
                  {t("settings.llm.test.received")}
                </span>
                <span className="llm-reply__meta">
                  {t("settings.llm.test.meta", {
                    engine: test.engine,
                    seconds: formatSeconds(test.reply.elapsedMs, locale),
                  })}
                </span>
              </p>
              {/* The reply is untrusted text: rendered as text, never as markup. */}
              <p className="llm-reply__text" data-testid="llm-reply-text">
                {test.reply.text}
              </p>
              {test.reply.outputTruncated ? (
                <p className="settings-row__hint">{t("settings.llm.test.cut")}</p>
              ) : null}
            </div>
          ) : null}
          {test.state === "error" ? (
            <div data-testid="llm-error" data-kind={test.kind}>
              <Notice
                tone={test.kind === "cancelled" ? "info" : "error"}
                title={t(`settings.llm.error.${test.kind}.title` as MessageKey)}
              >
                {t(`settings.llm.error.${test.kind}.body` as MessageKey)}
              </Notice>
            </div>
          ) : null}
        </div>
      </Row>
    </Card>
  );
}
