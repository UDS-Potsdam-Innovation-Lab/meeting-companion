import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { ChevronDownIcon } from "../../ui/icons";

/** One component of `licences.json` (written by `scripts/licences.mjs` from the lockfiles). */
export interface Component {
  name: string;
  /** Null for native libraries built into another component without a version of their own. */
  version: string | null;
  /** SPDX licence expression. */
  licence: string;
  kind: "rust" | "npm" | "native";
  /** The component that brings it in, with its version. */
  via?: string | null;
  /** Ids into `texts`: the full licence texts the component ships. */
  texts: string[];
}

export interface LicenceList {
  components: Component[];
  texts: Record<string, string>;
}

/** The components named first, with what they do; all others follow in one collapsed list. */
export const FEATURED: { name: string; label?: string; desc: MessageKey }[] = [
  { name: "whisper.cpp", desc: "legal.licences.desc.whisper.cpp" },
  { name: "whisper-rs", desc: "legal.licences.desc.whisper-rs" },
  { name: "sherpa-onnx", desc: "legal.licences.desc.sherpa-onnx" },
  { name: "ONNX Runtime", desc: "legal.licences.desc.onnxruntime" },
  { name: "tauri", label: "Tauri", desc: "legal.licences.desc.tauri" },
  { name: "react", label: "React", desc: "legal.licences.desc.react" },
  { name: "@fontsource-variable/inter", label: "Inter", desc: "legal.licences.desc.inter" },
];

/** Licences of the supported model families; no model is bundled. */
export const MODEL_LICENCES: { family: MessageKey; licence: string }[] = [
  { family: "legal.models.whisper", licence: "MIT" },
  { family: "legal.models.3dspeaker", licence: "Apache-2.0" },
  { family: "legal.models.wespeaker", licence: "CC-BY-4.0" },
  { family: "legal.models.nemo", licence: "CC-BY-4.0" },
];

/** The list is about 1 MB of text, so it is a chunk of its own, loaded when the section shows. */
export const loadLicenceList = () =>
  import("./licences.json").then((m) => (m.default ?? m) as unknown as LicenceList);

function LicenceEntry({
  component,
  texts,
  label,
  desc,
}: {
  component: Component;
  texts: Record<string, string>;
  label?: string;
  desc?: MessageKey;
}) {
  const { t } = useI18n();
  // The texts are only put into the page while the entry is open.
  const [open, setOpen] = useState(false);
  const name = label ?? component.name;
  return (
    <li className="licence" data-component={component.name}>
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="licence__summary">
          <span className="licence__head">
            <span className="licence__name">
              <strong>{name}</strong>
              {component.version ? <span className="licence__version">{component.version}</span> : null}
            </span>
            <span className="licence__meta">
              {desc ? <span>{t(desc)}</span> : null}
              {label ? <span>{component.name}</span> : null}
              {component.via ? <span>{t("legal.licences.via", { via: component.via })}</span> : null}
            </span>
          </span>
          <span className="licence__id">{component.licence}</span>
          <span className="licence__chevron" aria-hidden="true">
            <ChevronDownIcon />
          </span>
        </summary>
        {open ? (
          <div className="licence__texts">
            {component.texts.map((id) => (
              <pre key={id} className="licence__text" tabIndex={0}>
                {texts[id]}
              </pre>
            ))}
          </div>
        ) : null}
      </details>
    </li>
  );
}

function Others({ list, featured }: { list: LicenceList; featured: Set<Component> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const others = list.components.filter((c) => !featured.has(c));
  return (
    <details className="licences__others" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="licences__others-summary">
        <span>{t("legal.licences.others", { count: others.length })}</span>
        <span className="licence__chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </summary>
      {open ? (
        <ul className="licence-list">
          {others.map((c) => (
            <LicenceEntry key={`${c.kind}:${c.name}:${c.version}`} component={c} texts={list.texts} />
          ))}
        </ul>
      ) : null}
    </details>
  );
}

/** Frame 19d "Open-source licences": the named components, all others, and the model licences. */
export function Licences() {
  const { t } = useI18n();
  const [list, setList] = useState<LicenceList | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadLicenceList().then((l) => {
      if (!cancelled) setList(l);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const featured = list
    ? FEATURED.flatMap((f) => {
        const c = list.components.find((x) => x.name === f.name);
        return c ? [{ ...f, component: c }] : [];
      })
    : [];

  return (
    <div className="licences" aria-busy={list === null}>
      {list === null ? (
        <p className="licences__loading">{t("legal.licences.loading")}</p>
      ) : (
        <>
          <ul className="licence-list">
            {featured.map((f) => (
              <LicenceEntry
                key={f.name}
                component={f.component}
                texts={list.texts}
                label={f.label}
                desc={f.desc}
              />
            ))}
          </ul>
          <Others list={list} featured={new Set(featured.map((f) => f.component))} />
        </>
      )}
      <div className="models">
        <h3 className="models__title">{t("legal.models.title")}</h3>
        <p className="models__body">{t("legal.models.body")}</p>
        <table className="models__table">
          <thead className="visually-hidden">
            <tr>
              <th scope="col">{t("legal.models.family")}</th>
              <th scope="col">{t("legal.models.licence")}</th>
            </tr>
          </thead>
          <tbody>
            {MODEL_LICENCES.map((m) => (
              <tr key={m.family}>
                <td>{t(m.family)}</td>
                <td className="models__licence">{m.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
