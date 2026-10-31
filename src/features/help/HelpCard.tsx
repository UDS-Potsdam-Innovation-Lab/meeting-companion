import type { ReactNode } from "react";

/** One section of the Help & legal page: a card with an `h2` that "On this page" moves focus to. */
export function HelpCard({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="help-card" id={id} aria-labelledby={`${id}-title`}>
      <div className="help-card__head">
        <h2 className="help-card__title" id={`${id}-title`} tabIndex={-1}>
          {title}
        </h2>
        {sub ? <p className="help-card__sub">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}
