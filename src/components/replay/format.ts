"use client";

import { useMemo } from "react";

import type { StrategyView } from "@/domain/simulation/engine";
import { formatterFor } from "@/lib/i18n/format";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";

// The formatter lives in a plain module so server components can use it too.
export { formatterFor };


export function useFmt() {
  const locale = useLocale();
  return useMemo(() => formatterFor(locale), [locale]);
}

/** "Existing practice" / "Alternative 2", localised. */
export function useOptionName() {
  const t = useT();
  return (o: Pick<StrategyView, "id" | "kind">) => (o.kind === "baseline" ? t("sim.option.baseline") : fmt(t("sim.option.alt"), { n: o.id.replace("alternative-", "") }));
}

/** Localised indicator names and units; unknown keys fall back to the engine's English label. */
export function useIndicatorText() {
  const t = useT();
  const has = (k: string): k is MessageKey => k in MESSAGES.en;
  return {
    label: (key: string, fallback: string) => {
      const k = `sim.ind.${key}`;
      return has(k) ? t(k) : fallback;
    },
    unit: (u: string) => {
      const k = `sim.unit.${u}`;
      return has(k) ? t(k) : u;
    },
  };
}
