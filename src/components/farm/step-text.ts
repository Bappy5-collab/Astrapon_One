import type { FieldStep } from "@/domain/farm/progress";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";

type T = (key: MessageKey) => string;
const has = (k: string): k is MessageKey => k in MESSAGES.en;

/**
 * A field step's texts in the farmer's language, from the step's language-neutral codes. English
 * counts use a separate ".one" entry for exactly one ("1 season recorded").
 */
export function stepText(s: FieldStep, t: T, int: (n: number) => string = String) {
  const status = s.statusParts
    .map((p) => {
      const one = `app.step.status.${p.code}.one`;
      const key = p.n === 1 && has(one) ? one : (`app.step.status.${p.code}` as MessageKey);
      return fmt(t(key), { n: int(p.n ?? 0) });
    })
    .join(" · ");
  return {
    title: t(`app.step.${s.id}.title` as MessageKey),
    why: t(`app.step.${s.id}.why` as MessageKey),
    status,
    action: t(`app.step.action.${s.actionCode}` as MessageKey),
  };
}
