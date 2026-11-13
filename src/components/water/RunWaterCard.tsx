"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { Section } from "@/components/farm/ui";
import { ButtonLink } from "@/components/links";
import type { RunDemand } from "@/domain/water/demand";
import type { PlannerResult } from "@/domain/water/plan";
import { useT } from "@/lib/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/sim-messages";

import { useWaterFmt } from "./useWaterFmt";

/**
 * Water & Energy beside the rotation comparison. Shows the newest saved water plan made from this
 * run (stored values only), or what the run can offer the planner. It never changes the ranking.
 */
export function RunWaterCard({ fieldId, runId, demand, saved }: { fieldId: string; runId: string; demand: RunDemand; saved: { id: string; version: number; name: string; createdAt: string; result: PlannerResult } | null }) {
  const t = useT();
  const w = useWaterFmt();
  const href = `/fields/${fieldId}/water?run=${runId}`;
  return (
    <Section title={t("app.water.card.title")} intro={t("app.water.card.intro")} aside={undefined}>
      {saved ? (
        <>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {fmt(t("app.water.card.from"), { v: w.digits(String(saved.version)), name: saved.name, date: w.date(saved.createdAt.slice(0, 10)) })}
          </Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label={t("app.water.card.tableAria")}>
              <TableHead>
                <TableRow>
                  <TableCell>{t("app.water.card.option")}</TableCell>
                  <TableCell align="right">{t("app.water.card.water")}</TableCell>
                  <TableCell align="right">{t("app.water.card.energy")}</TableCell>
                  <TableCell align="right">{t("app.water.card.peak")}</TableCell>
                  <TableCell align="right">{t("app.water.card.pv")}</TableCell>
                  <TableCell>{t("app.water.r.supply")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {saved.result.options.map((o) => (
                  <TableRow key={o.optionId}>
                    <TableCell>{o.label}</TableCell>
                    <TableCell align="right">{w.num(o.totals.grossM3PerYear, 0)}</TableCell>
                    <TableCell align="right">{w.range(o.totals.energyKWhPerYear, 0)}</TableCell>
                    <TableCell align="right">{w.range(o.totals.peakPowerKW, 2)}</TableCell>
                    <TableCell align="right">{w.range(o.totals.requiredKwp, 2)}</TableCell>
                    <TableCell>{o.totals.supplyStatus === "unknown" ? t("app.water.card.unknown") : t(`app.water.supply.${o.totals.supplyStatus}`)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {saved.result.comparison.energyRankingNote}
          </Typography>
        </>
      ) : demand.unavailable ? (
        <Alert severity="info">{demand.unavailable}</Alert>
      ) : (
        <Typography variant="body2">{fmt(t("app.water.card.hasNeed"), { n: w.int(demand.options.filter((o) => !o.unavailable).length), total: w.int(demand.options.length) })}</Typography>
      )}
      <ButtonLink href={href} variant="outlined" sx={{ mt: 1.5 }}>
        {saved ? t("app.water.card.open") : t("app.water.card.plan")}
      </ButtonLink>
    </Section>
  );
}
