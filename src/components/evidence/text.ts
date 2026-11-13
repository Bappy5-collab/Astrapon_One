import type { PipelineSource } from "@/domain/evidence/catalog";
import { BASELINE, DRY_DAY_MM, DRY_SPELL_MIN_DAYS, FROST_THRESHOLD_C, HEAT_THRESHOLD_C } from "@/domain/evidence/indicators";
import type { Metric } from "@/domain/evidence/view";
import { useT } from "@/lib/i18n/I18nProvider";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";

const has = (k: string): k is MessageKey => k in MESSAGES.en;
const VARS = { frost: FROST_THRESHOLD_C, heat: HEAT_THRESHOLD_C, dry: DRY_DAY_MM, days: DRY_SPELL_MIN_DAYS, from: BASELINE.start, to: BASELINE.end };

/**
 * Plain-language evidence texts in the farmer's language: metric names, indicator one-liners and
 * source descriptions. Unknown ids fall back to the catalogue's English text. Values, periods and
 * provenance stay as the pipeline wrote them.
 */
export function useEvidenceText() {
  const t = useT();
  const pick = (k: string, fallback: string) => (has(k) ? fmt(t(k), VARS) : fallback);
  return {
    metricLabel: (m: Pick<Metric, "indicator" | "label">) => pick(`app.ev.metric.${m.indicator}`, m.label),
    indicatorLabel: (id: string, fallback: string) => pick(`app.ev.ind.${id}`, fallback),
    plain: (id: string, fallback: string) => pick(`app.ev.plain.${id}`, fallback),
    sourceShort: (s: PipelineSource, fallback: string) => pick(`app.ev.src.${s}.short`, fallback),
    sourcePlain: (s: PipelineSource, fallback: string) => pick(`app.ev.src.${s}.plain`, fallback),
  };
}
