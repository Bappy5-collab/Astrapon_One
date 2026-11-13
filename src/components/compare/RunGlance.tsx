"use client";

import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import BuildCircleRoundedIcon from "@mui/icons-material/BuildCircleRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { ButtonLink } from "@/components/links";
import { useFmt, useOptionName } from "@/components/replay/format";
import type { EngineResult, RunView } from "@/domain/simulation/engine";
import { fixList, glance, type FixItem, type GlanceTile } from "@/domain/simulation/glance";
import { optionsOf } from "@/domain/simulation/view";
import { useT } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";
import { color, radius, tokens } from "@/theme/tokens";

/** Four plain tiles: the top option against the current rotation (stored values only). */
export function RunGlance({ run }: { run: RunView }) {
  const t = useT();
  const f = useFmt();
  const optionName = useOptionName();
  const g = glance(run);
  if (!g || !g.tiles.length) return null;
  const top = optionsOf(run).find((o) => o.id === g.topId);
  if (!top) return null;
  const hasBase = g.baselineId != null;
  const value = (tile: GlanceTile, v: number | null) => {
    if (v == null) return "—";
    if (tile.unit === "ratio") return f.pct(v);
    if (tile.unit === "mm/year") return `${f.int(v)} mm`;
    if (tile.unit === "days/year") return `${f.int(v)}`;
    return f.num(v, 1);
  };
  const change = (tile: GlanceTile) => {
    if (tile.delta == null || tile.verdict === "same") return null;
    const abs = Math.abs(tile.delta);
    const v = tile.unit === "ratio" ? `${f.int(abs * 100)} %` : tile.unit === "mm/year" ? `${f.int(abs)} mm` : f.num(abs, 1);
    return fmt(t(tile.delta < 0 ? "sim.glance.less" : "sim.glance.more"), { v });
  };
  return (
    <Box component="section" aria-labelledby="gl-h" data-tour="run-summary" sx={{ mb: 2.5 }}>
      <Typography id="gl-h" component="h3" variant="subtitle1" sx={{ fontWeight: 700, mb: 1.25 }}>
        {fmt(t(hasBase ? "sim.glance.title" : "sim.glance.titleNoBase"), { top: `${optionName(top)} (${top.label})` })}
      </Typography>
      <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" } }}>
        {g.tiles.map((tile) => {
          const tone = tile.verdict === "better" ? { bg: "#F4F9E6", line: tokens.lime[500], fg: tokens.forest[800], Icon: tile.delta! < 0 ? ArrowDownwardRoundedIcon : ArrowUpwardRoundedIcon } : tile.verdict === "worse" ? { bg: "#FBF1ED", line: "#E9C3B7", fg: tokens.clay, Icon: tile.delta! < 0 ? ArrowDownwardRoundedIcon : ArrowUpwardRoundedIcon } : { bg: color.surface, line: color.line, fg: tokens.neutral[700], Icon: RemoveRoundedIcon };
          const c = change(tile);
          return (
            <Box key={tile.key} id={`voice-tile-${tile.key}`} sx={{ p: 1.75, borderRadius: `${radius.md}px`, border: `1px solid ${tone.line}`, bgcolor: tone.bg, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
                {t(`sim.glance.topic.${tile.topic}.${tile.key}` as MessageKey)}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
                <Typography sx={{ fontSize: "1.6rem", fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{value(tile, tile.top)}</Typography>
                {tile.unit.endsWith("/year") && (
                  <Typography variant="body2" color="text.secondary">
                    {t("sim.glance.perYear")}
                  </Typography>
                )}
              </Stack>
              {hasBase && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  {t("sim.glance.now")}: {value(tile, tile.now)}
                </Typography>
              )}
              {tile.verdict && (
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.75, color: tone.fg }}>
                  <tone.Icon fontSize="small" aria-hidden />
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {t(tile.verdict === "better" ? "sim.glance.better" : tile.verdict === "worse" ? "sim.glance.worse" : "sim.glance.same")}
                    {c ? ` · ${c}` : ""}
                  </Typography>
                </Stack>
              )}
            </Box>
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {hasBase ? t("sim.glance.foot") : t("sim.glance.noBase")}
      </Typography>
      {(() => {
        const bare = g.tiles.find((x) => x.topic === "bare");
        return bare?.verdict === "worse" && bare.delta != null && bare.delta >= 30 ? (
          <Typography variant="body2" sx={{ mt: 1.25, p: 1.25, borderRadius: `${radius.md}px`, bgcolor: "#FBF1ED", border: "1px solid #E9C3B7" }}>
            {fmt(t("sim.glance.bareMore"), { days: f.int(bare.delta) })}
          </Typography>
        ) : null;
      })()}
      {top.bareFill && top.bareFill.crops.length > 0 && (
        <Box sx={{ mt: 1.25, p: 1.5, borderRadius: `${radius.md}px`, bgcolor: color.surface, border: `1px solid ${color.line}` }}>
          <Typography variant="subtitle2" component="h4" sx={{ mb: 0.5 }}>
            {fmt(t("sim.glance.fillTitle"), { date: f.dayMonth(top.bareFill.gapStart), days: f.int(top.bareFill.gapDays) })}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {top.bareFill.crops.map((c) => (
              <li key={c.cropId}>
                <Typography variant="body2" component="span">
                  {fmt(t("sim.glance.fillItem"), { crop: c.crop, len: f.int(c.length), source: c.source })}
                  {c.legume ? ` · ${t("sim.glance.legume")}` : ""}
                </Typography>
              </li>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {t("sim.glance.fillNote")}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

const GO: Record<FixItem["code"], { label: MessageKey; href: (fieldId: string, scenarioId: string | null) => string }> = {
  unknown_crops: { label: "sim.fix.go.settings", href: (_, s) => (s ? `/scenarios/${s}` : "/runs") },
  no_feasible: { label: "sim.fix.go.settings", href: (_, s) => (s ? `/scenarios/${s}` : "/runs") },
  no_weather: { label: "sim.fix.go.weather", href: (f) => `/fields/${f}/evidence` },
  no_soil: { label: "sim.fix.go.soil", href: (f) => `/fields/${f}/records` },
  no_history: { label: "sim.fix.go.history", href: (f) => `/fields/${f}/records` },
};

/** What to add for a (more) complete comparison, with one button per item. */
export function RunFixList({ result, fieldId, scenarioId }: { result: EngineResult; fieldId: string; scenarioId: string | null }) {
  const t = useT();
  const items = fixList(result);
  if (!items.length) return null;
  const blocked = items.some((i) => i.blocking);
  return (
    <Box component="section" aria-labelledby="fix-h" sx={{ mb: 3, p: { xs: 2, md: 2.5 }, borderRadius: `${radius.lg}px`, border: `1px solid ${blocked ? "#E9C3B7" : tokens.lime[500]}`, bgcolor: blocked ? "#FBF1ED" : "#F7FBEE" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
        <BuildCircleRoundedIcon sx={{ color: blocked ? tokens.clay : tokens.forest[600] }} aria-hidden />
        <Typography id="fix-h" component="h2" variant="h6" sx={{ fontSize: "1.1rem" }}>
          {t(blocked ? "sim.fix.titleBlocked" : "sim.fix.title")}
        </Typography>
      </Stack>
      <Box component="ol" sx={{ m: 0, pl: 3, display: "grid", gap: 1.25 }}>
        {items.map((i) => (
          <Box component="li" key={i.code}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
              <Typography variant="body2">{fmt(t(`sim.fix.${i.code}` as MessageKey), { crops: i.detail.join(", ") })}</Typography>
              <ButtonLink href={GO[i.code].href(fieldId, scenarioId)} size="small" variant={i.blocking ? "contained" : "outlined"} sx={{ flexShrink: 0, alignSelf: { xs: "flex-start", sm: "center" } }}>
                {t(GO[i.code].label)}
              </ButtonLink>
            </Stack>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
