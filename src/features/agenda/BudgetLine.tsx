import { useI18n } from "../../i18n";
import { budget, type Meeting } from "./model";

/** "N of M min planned · B min buffer", or how far over the slot the plan is. Not colour-only. */
export function BudgetLine({ meeting }: { meeting: Pick<Meeting, "start" | "end" | "items"> }) {
  const { t } = useI18n();
  const b = budget(meeting);
  const over = b.over > 0;
  return (
    <p className={`budget-line${over ? " budget-line--over" : ""}`} role="status" data-over={over}>
      {over
        ? t("agenda.budget.over", { planned: b.planned, slot: b.slot, over: b.over })
        : t("agenda.budget.within", { planned: b.planned, slot: b.slot, buffer: b.buffer })}
    </p>
  );
}
