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

import type { OptionResult, PlannerInput, PlannerResult, Scenario, SourceTotals } from "@/domain/water/plan";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";
import { color, radius, tokens } from "@/theme/tokens";

import { ClassChip } from "./ClassChip";
import type { WaterFormatter } from "./format";
import { useWaterFmt } from "./useWaterFmt";

type T = (key: MessageKey) => string;

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Box sx={{ minWidth: 150, flex: "1 1 150px", p: 1.5, borderRadius: `${radius.md}px`, bgcolor: color.surface, border: `1px solid ${tokens.neutral[200]}` }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 700, fontSize: "1.1rem", fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
      {note && (
        <Typography variant="caption" color="text.secondary" component="div">
          {note}
        </Typography>
      )}
    </Box>
  );
}

const maxOf = (a: Record<Scenario, number> | null, b: Record<Scenario, number> | null): Record<Scenario, number> | null =>
  !a ? b : !b ? a : { low: Math.max(a.low, b.low), high: Math.max(a.high, b.high) };

/** Main source vs dry-season groundwater backup, and what the backup needs (model 1.1.0 results only). */
function BackupBlock({ main, backup, input, t, w }: { main: SourceTotals; backup: SourceTotals; input: PlannerInput; t: T; w: WaterFormatter }) {
  const b = input.backup;
  if (!b) return null;
  const pct = (v: number | null) => (v == null ? "—" : `${w.num(v * 100, 0)} %`);
  const depth = b.lift.depthM;
  const dd = b.lift.levelKind === "static_plus_drawdown" ? b.lift.drawdownM : null;
  const deepest = depth ? depth.high + (dd?.high ?? 0) : null;
  const pv = maxOf(main.requiredKwp, backup.requiredKwp);
  const noDemand = backup.grossM3PerYear === 0;
  const pipeLen = `${w.num(b.pipe.lengthM.low, 0)}${b.pipe.lengthM.high !== b.pipe.lengthM.low ? `–${w.num(b.pipe.lengthM.high, 0)}` : ""}`;
  return (
    <Box sx={{ mt: 1.5, p: 1.5, borderRadius: `${radius.md}px`, border: `1px solid ${tokens.forest[400]}`, bgcolor: color.surface }}>
      <Typography component="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
        {fmt(t("app.water.r.backupTitle"), { label: b.label, months: w.monthList(b.months) })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("app.water.r.backupIntro")}
      </Typography>
      {noDemand ? (
        <Alert severity="info">{t("app.water.r.backupNoDemand")}</Alert>
      ) : (
        <>
          <Stack direction="row" useFlexGap spacing={1.25} sx={{ flexWrap: "wrap" }}>
            <Metric label={t("app.water.r.wellWater")} value={backup.grossM3PerYear == null ? "—" : `${w.num(backup.grossM3PerYear, 0)} m³`} note={fmt(t("app.water.r.shareOfYear"), { pct: pct(backup.shareOfWater) })} />
            <Metric label={t("app.water.r.wellPeakDay")} value={backup.peakDailyM3 == null ? "—" : `${w.num(backup.peakDailyM3, 1)} m³/day`} note={w.month(backup.peakMonth)} />
            <Metric label={t("app.water.r.wellFlow")} value={w.range(backup.peakFlowM3PerH, 2, " m³/h")} />
            <Metric label={t("app.water.r.wellHead")} value={w.range(backup.peakHeadM, 1, " m")} />
            <Metric label={t("app.water.r.wellPower")} value={w.range(backup.peakPowerKW, 2, " kW")} />
            <Metric label={t("app.water.r.wellEnergy")} value={w.range(backup.energyKWhPerYear, 0, " kWh")} />
            <Metric label={t("app.water.r.backupPv")} value={w.range(backup.requiredKwp, 2, " kWp")} note={backup.criticalSolarMonth ? fmt(t("app.water.r.critical"), { month: w.month(backup.criticalSolarMonth) }) : undefined} />
            {backup.supplyDeficitM3PerYear != null && (
              <Metric label={t("app.water.r.yieldCheck")} value={backup.supplyDeficitM3PerYear > 0 ? fmt(t("app.water.r.yieldShort"), { v: w.num(backup.supplyDeficitM3PerYear, 0) }) : t("app.water.r.yieldOk")} />
            )}
          </Stack>
          <Typography component="h5" variant="subtitle2" sx={{ mt: 1.5 }}>
            {t("app.water.r.needTitle")}
          </Typography>
          <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
            <li>
              {t("app.water.r.needWell")}
              {deepest != null ? ` ${fmt(t("app.water.r.needWellDepth"), { m: w.num(deepest, 1) })}` : ""}.
            </li>
            <li>
              {fmt(t("app.water.r.needPump"), { flow: w.range(backup.peakFlowM3PerH, 2, " m³/h"), head: w.range(backup.peakHeadM, 1, " m"), power: w.range(backup.peakPowerKW, 2, " kW"), eff: w.num(input.pump.etaPumpMotor * 100, 0) })}
            </li>
            <li>
              {fmt(t("app.water.r.needSolar"), { kwp: w.range(backup.requiredKwp, 2, " kWp") })}
              {pv && main.requiredKwp ? fmt(t("app.water.r.needSolarBoth"), { kwp: w.range(pv, 2, " kWp") }) : ""}
              {fmt(t("app.water.r.needController"), { eff: w.num(input.solar.controllerEfficiency * 100, 0) })}
            </li>
            <li>{fmt(t("app.water.r.needPipe"), { len: pipeLen, dia: w.num(input.pipe.innerDiameterMm, 0) })}</li>
            {b.capacityM3PerDay == null && (
              <li>{fmt(t("app.water.r.needTest"), { need: backup.peakDailyM3 == null ? t("app.water.r.needTestUnknown") : fmt(t("app.water.r.needTestDaily"), { v: w.num(backup.peakDailyM3, 1) }) })}</li>
            )}
            <li>{t("app.water.r.needPermission")}</li>
          </Box>
        </>
      )}
      <Typography variant="body2" sx={{ mt: 1 }}>
        {fmt(t("app.water.r.mainSource"), {
          months: w.monthList(main.months) || t("app.water.r.noMonths"),
          water: main.grossM3PerYear == null ? "—" : `${w.num(main.grossM3PerYear, 0)} m³/yr (${pct(main.shareOfWater)})`,
          power: w.range(main.peakPowerKW, 2, " kW"),
          head: w.range(main.peakHeadM, 1, " m"),
          energy: w.range(main.energyKWhPerYear, 0, " kWh"),
        })}
      </Typography>
    </Box>
  );
}

/** One plain sentence per option: yearly water, busiest month, pump size and solar size (only the parts that are known). */
function InShort({ o, input, t, w }: { o: OptionResult; input: PlannerInput; t: T; w: WaterFormatter }) {
  const tt = o.totals;
  if (o.unavailable || tt.grossM3PerYear == null) return null;
  const parts = [fmt(t("app.water.r.short.water"), { v: w.num(tt.grossM3PerYear, 0) })];
  if (tt.peakMonth && tt.peakDailyM3 != null) parts.push(fmt(t("app.water.r.short.peak"), { month: w.month(tt.peakMonth), v: w.num(tt.peakDailyM3, 1) }));
  if (tt.peakPowerKW) parts.push(fmt(t("app.water.r.short.power"), { v: w.range(tt.peakPowerKW, 2, " kW") }));
  if (input.solar.mode === "size" && tt.requiredKwp) parts.push(fmt(t("app.water.r.short.pv"), { v: w.range(tt.requiredKwp, 2, " kWp") }));
  return (
    <Typography sx={{ mb: 1.5, p: 1.25, borderRadius: `${radius.md}px`, bgcolor: color.surface, borderLeft: `4px solid ${tokens.forest[400]}` }}>
      <Box component="strong">{t("app.water.r.short.title")}</Box> {parts.join("; ")}.
    </Typography>
  );
}

function OptionCard({ o, input, first, t, w }: { o: OptionResult; input: PlannerInput; first: boolean; t: T; w: WaterFormatter }) {
  const tt = o.totals;
  const evaluate = input.solar.mode === "evaluate";
  return (
    <Box component="article" aria-label={o.label} sx={{ p: { xs: 1.5, md: 2 }, mb: 2, borderRadius: `${radius.lg}px`, border: `1px solid ${first ? tokens.forest[400] : color.line}`, bgcolor: color.surfaceRaised }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 1 }}>
        <Typography component="h3" sx={{ fontWeight: 700, fontSize: "1.05rem" }}>
          {o.label}
        </Typography>
        <Chip size="small" label={o.kind === "baseline" ? t("app.water.r.current") : o.kind === "alternative" ? t("app.water.r.alternative") : t("app.water.r.yourDemand")} sx={{ height: 22 }} />
        <ClassChip kind={o.kind === "manual" ? (input.demand.mode === "manual" && input.demand.basis === "farmer_report" ? "farmer" : "hypothetical") : "modelled"} />
      </Stack>
      {o.unavailable && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          {o.unavailable}
        </Alert>
      )}
      <InShort o={o} input={input} t={t} w={w} />
      <Stack direction="row" useFlexGap spacing={1.25} sx={{ flexWrap: "wrap" }}>
        <Metric
          label={t("app.water.r.gross")}
          value={tt.grossM3PerYear == null ? "—" : `${w.num(tt.grossM3PerYear, 0)} m³`}
          note={o.window ? fmt(t("app.water.r.window"), { years: w.digits(o.window.years.join("–")) }) : input.demand.mode === "manual" ? t("app.water.r.statedMonths") : undefined}
        />
        {o.annual.grossMedianM3 != null && (
          <Metric label={t("app.water.r.medianDry")} value={`${w.num(o.annual.grossMedianM3, 0)} / ${w.num(o.annual.grossP80M3, 0)} m³`} note={fmt(t("app.water.r.netNeed"), { median: w.num(o.annual.netMedianMm, 0), dry: w.num(o.annual.netP80Mm, 0) })} />
        )}
        <Metric label={t("app.water.r.peakDay")} value={tt.peakDailyM3 == null ? "—" : `${w.num(tt.peakDailyM3, 1)} m³/day`} note={w.month(tt.peakMonth)} />
        <Metric label={t("app.water.r.flow")} value={w.range(tt.peakFlowM3PerH, 2, " m³/h")} />
        <Metric label={t("app.water.r.head")} value={w.range(tt.peakHeadM, 1, " m")} />
        <Metric label={t("app.water.r.power")} value={w.range(tt.peakPowerKW, 2, " kW")} />
        <Metric label={t("app.water.r.energy")} value={w.range(tt.energyKWhPerYear, 0, " kWh")} />
        <Metric
          label={evaluate ? t("app.water.r.lowestCoverage") : t("app.water.r.pvNeeded")}
          value={evaluate ? (tt.worstCoverage ? w.range({ low: tt.worstCoverage.high * 100, high: tt.worstCoverage.low * 100 }, 0, " %") : "—") : w.range(tt.requiredKwp, 2, " kWp")}
          note={tt.criticalSolarMonth ? fmt(t("app.water.r.critical"), { month: w.month(tt.criticalSolarMonth) }) : undefined}
        />
        {input.solar.mode === "size" && tt.requiredKwpLowSunDay && <Metric label={t("app.water.r.lowSun")} value={w.range(tt.requiredKwpLowSunDay, 2, " kWp")} note={t("app.water.r.lowSunNote")} />}
        {evaluate && <Metric label={t("app.water.r.shortfall")} value={w.range(tt.deficitKWhPerYear, 0, " kWh")} />}
        <Metric label={t("app.water.r.supply")} value={t(`app.water.supply.${tt.supplyStatus}`)} note={tt.supplyDeficitM3PerYear ? fmt(t("app.water.r.deficit"), { v: w.num(tt.supplyDeficitM3PerYear, 0) }) : undefined} />
        {tt.tankDaysOfPeak != null && <Metric label={t("app.water.r.tank")} value={fmt(t("app.water.r.tankDays"), { n: w.num(tt.tankDaysOfPeak, 1) })} />}
      </Stack>
      {tt.sources && <BackupBlock main={tt.sources.main} backup={tt.sources.backup} input={input} t={t} w={w} />}
      {tt.instantaneous && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {tt.instantaneous.high === "sufficient" ? t("app.water.r.fullSunCan") : tt.instantaneous.low === "sufficient" ? t("app.water.r.fullSunLow") : t("app.water.r.fullSunCannot")}
        </Typography>
      )}
      {tt.frictionShareOfHead != null && tt.frictionShareOfHead > 0.5 && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {fmt(t("app.water.r.friction"), { pct: w.num(tt.frictionShareOfHead * 100, 0), v: w.num(tt.peakVelocityMPerS, 1) })}
        </Alert>
      )}
      {tt.gravityAssisted && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {t("app.water.r.gravity")}
        </Typography>
      )}
      {o.months.length > 0 && (
        <Box component="details" sx={{ mt: 1.5 }}>
          <Box component="summary" sx={{ cursor: "pointer", fontWeight: 600, color: tokens.forest[600] }}>
            {t("app.water.monthByMonth")}
          </Box>
          <Box sx={{ overflowX: "auto", mt: 1 }}>
            <Table size="small" aria-label={fmt(t("app.water.r.monthlyAria"), { option: o.label })}>
              <TableHead>
                <TableRow>
                  <TableCell>{t("app.water.month")}</TableCell>
                  {tt.sources && <TableCell>{t("app.water.r.source")}</TableCell>}
                  <TableCell align="right">{t("app.water.r.colNet")}</TableCell>
                  <TableCell align="right">{t("app.water.r.colGross")}</TableCell>
                  <TableCell align="right">{t("app.water.r.colFlow")}</TableCell>
                  <TableCell align="right">{t("app.water.r.colHead")}</TableCell>
                  <TableCell align="right">{t("app.water.r.colEnergy")}</TableCell>
                  <TableCell align="right">{t("app.water.r.colSun")}</TableCell>
                  <TableCell align="right">{evaluate ? t("app.water.r.colCoverage") : t("app.water.r.colPv")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {o.months.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell>{w.month(m.key)}</TableCell>
                    {tt.sources && <TableCell>{m.source === "backup" ? t("app.water.r.srcBackup") : t("app.water.r.srcMain")}</TableCell>}
                    <TableCell align="right">{w.num(m.netMm, 1)}</TableCell>
                    <TableCell align="right">{w.num(m.grossM3, 0)}</TableCell>
                    <TableCell align="right">{m.pump ? w.range({ low: m.pump.low.flowM3PerH, high: m.pump.high.flowM3PerH }, 2) : "—"}</TableCell>
                    <TableCell align="right">{m.pump && (m.grossM3 ?? 0) > 0 ? w.range({ low: m.pump.low.head.totalHeadM, high: m.pump.high.head.totalHeadM }, 1) : "—"}</TableCell>
                    <TableCell align="right">{m.pump ? w.range({ low: m.pump.low.energyKWh, high: m.pump.high.energyKWh }, 0) : "—"}</TableCell>
                    <TableCell align="right">{w.num(m.pv?.meanPsh ?? null, 2)}</TableCell>
                    <TableCell align="right">
                      {evaluate ? (m.pv?.coverage ? `${w.num(m.pv.coverage.high * 100, 0)}–${w.num(m.pv.coverage.low * 100, 0)} %` : "—") : (m.grossM3 ?? 0) > 0 ? w.range(m.pv?.requiredKwp, 2) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t("app.water.r.monthlyNote")}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/** Results of one planner calculation (live or saved). Pure rendering; reads only the given result. */
export function ResultsView({ result, input }: { result: PlannerResult; input: PlannerInput }) {
  const t = useT();
  const w = useWaterFmt();
  const locale = useLocale();
  const order = result.comparison.energyRanking ?? result.options.map((o) => o.optionId);
  const options = [...result.options].sort((a, b) => order.indexOf(a.optionId) - order.indexOf(b.optionId));
  const english = locale === "bn" ? ` (${t("sim.why.englishNote")})` : "";
  return (
    <Box>
      {result.pumpUnavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {result.pumpUnavailable}
        </Alert>
      )}
      {result.solarUnavailable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {result.solarUnavailable}
        </Alert>
      )}
      <Typography variant="body2" sx={{ mb: 2 }}>
        {t("app.water.r.ranges")} {result.comparison.energyRankingNote}
      </Typography>
      {options.map((o, i) => (
        <OptionCard key={o.optionId} o={o} input={input} first={i === 0 && !!result.comparison.energyRanking} t={t} w={w} />
      ))}
      <Alert severity="info" sx={{ mb: 2 }}>
        {t("app.water.r.feasibility")}
      </Alert>
      <Box component="details" sx={{ mb: 1 }}>
        <Box component="summary" sx={{ cursor: "pointer", fontWeight: 600, color: tokens.forest[600] }}>
          {fmt(t("app.water.r.assumptionsGaps"), { n: w.int(result.assumptions.length + result.gaps.length) })}
          {english}
        </Box>
        <Typography component="h4" variant="subtitle2" sx={{ mt: 1 }}>
          {t("app.water.r.gaps")}
        </Typography>
        <Box component="ul" sx={{ mt: 0.5, pl: 3 }}>
          {result.gaps.length ? result.gaps.map((g) => <li key={g}>{g}</li>) : <li>{t("app.water.r.noneRecorded")}</li>}
        </Box>
        <Typography component="h4" variant="subtitle2">
          {t("app.water.r.assumptions")}
        </Typography>
        <Box component="ul" sx={{ mt: 0.5, pl: 3 }}>
          {result.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary">
          {fmt(t("app.water.r.model"), { v: result.modelVersion })}
        </Typography>
      </Box>
    </Box>
  );
}
