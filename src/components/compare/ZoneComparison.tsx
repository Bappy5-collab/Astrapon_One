"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { Section } from "@/components/farm/ui";
import { useFmt, useIndicatorText } from "@/components/replay/format";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/sim-messages";
import type { StrategyView, ZoneResult } from "@/domain/simulation/engine";
import { color, radius, tokens } from "@/theme/tokens";

const KEYS = ["relative_water_supply", "irrigation_requirement", "climatic_water_balance", "bare_days", "crop_diversity"] as const;

function valueOf(s: StrategyView, key: string, unit: (u: string) => string, digits: (s: string) => string): string {
  const v = s.indicators[key];
  return v?.value == null ? "—" : `${digits(String(v.value))} ${v.unit === "ratio" || v.unit === "count" ? "" : unit(v.unit)}`.trim();
}

/**
 * Zone-level rotations (engine 1.2.0): each zone with its own seasons or soil test compared on its
 * own records. Stored values only; nothing is recalculated here.
 */
export function ZoneComparison({ zones }: { zones: ZoneResult[] }) {
  const t = useT();
  const f = useFmt();
  const locale = useLocale();
  const ind = useIndicatorText();
  const digits = f.digits;

  const english = locale === "bn" ? ` (${t("sim.why.englishNote")})` : "";
  return (
    <Section id="zones" title={t("app.zone.title")} intro={t("app.zone.intro")}>
      {zones.map((z) => {
        const run = z.runs.find((r) => r.kind === "historical_replay") ?? null;
        const options = run ? [...(run.baseline ? [run.baseline] : []), ...run.alternatives] : [];
        const order = run?.comparison?.ranking ?? options.map((o) => o.id);
        const ranked = order.map((id) => options.find((o) => o.id === id)!).filter(Boolean);
        const keys = KEYS.filter((k) => ranked.some((o) => o.indicators[k]?.value != null));
        return (
          <Box key={z.zoneId || z.name} component="article" aria-label={fmt(t("app.zone.aria"), { name: z.name })} sx={{ p: 2, mb: 2, borderRadius: `${radius.lg}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 1 }}>
              <Typography component="h3" sx={{ fontWeight: 700, fontSize: "1.05rem" }}>
                {z.name}
              </Typography>
              <Chip size="small" label={z.historyBasis === "zone" ? t("app.zone.ownSeasons") : t("app.zone.fieldSeasons")} sx={{ height: 22, bgcolor: z.historyBasis === "zone" ? tokens.lime[200] : tokens.neutral[150] }} />
              <Chip size="small" label={z.soilBasis === "zone" ? t("app.zone.ownSoil") : t("app.zone.fieldSoil")} sx={{ height: 22, bgcolor: z.soilBasis === "zone" ? tokens.lime[200] : tokens.neutral[150] }} />
            </Stack>
            {z.sameAsField || !run ? (
              <Typography variant="body2" color="text.secondary">
                {z.messages[0] ?? t("app.zone.shares")}
              </Typography>
            ) : (
              <>
                {run.messages.map((m) => (
                  <Alert key={m} severity="info" sx={{ mb: 1 }}>
                    {m}
                  </Alert>
                ))}
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small" aria-label={fmt(t("app.zone.tableAria"), { name: z.name })}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{t("app.zone.rank")}</TableCell>
                        <TableCell>{t("app.water.card.option")}</TableCell>
                        <TableCell align="right">{t("app.zone.score")}</TableCell>
                        {keys.map((k) => (
                          <TableCell key={k} align="right">
                            {ind.label(k, ranked[0]?.indicators[k]?.detail ?? k)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ranked.map((o, i) => (
                        <TableRow key={o.id}>
                          <TableCell>{f.int(i + 1)}</TableCell>
                          <TableCell>
                            {o.label} {o.kind === "baseline" && <Chip size="small" label={t("app.zone.current")} sx={{ height: 20, ml: 0.5 }} />}
                          </TableCell>
                          <TableCell align="right">{run.comparison?.scores[o.id] != null ? digits(String(run.comparison.scores[o.id])) : "—"}</TableCell>
                          {keys.map((k) => (
                            <TableCell key={k} align="right">
                              {valueOf(o, k, ind.unit, digits)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                {run.comparison && (
                  <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                    {run.comparison.stability === "stable" ? t("app.zone.stable") : run.comparison.stability === "fragile" ? t("app.zone.fragile") : t("app.zone.single")}
                  </Typography>
                )}
                {z.gaps.length > 0 && (
                  <Box component="details" sx={{ mt: 1 }}>
                    <Box component="summary" sx={{ cursor: "pointer", fontWeight: 600, color: tokens.forest[600] }}>
                      {fmt(t("app.zone.gaps"), { n: f.int(z.gaps.length) })}
                      {english}

                    </Box>
                    <Box component="ul" sx={{ pl: 3, mb: 0 }}>
                      {z.gaps.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </Box>
                  </Box>
                )}
              </>
            )}
          </Box>
        );
      })}
    </Section>
  );
}
