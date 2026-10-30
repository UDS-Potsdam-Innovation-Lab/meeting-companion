import type { ReactNode } from "react";

interface Props {
  id: string;
  label: string;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

/** Label, control and the error message shown next to it. The control sets `aria-describedby`. */
export function Field({ id, label, error, className, children }: Props) {
  return (
    <div className={`field ${className ?? ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field__error" id={errorId(id)}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const errorId = (id: string) => `${id}-error`;

/** Props that tie an input to its error message. */
export function invalidProps(id: string, error?: string | null) {
  return error ? { "aria-invalid": true as const, "aria-describedby": errorId(id) } : {};
}
