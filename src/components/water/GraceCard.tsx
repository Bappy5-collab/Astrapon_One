import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { GraceContext } from "@/domain/water/grace";
import { color, radius, tokens } from "@/theme/tokens";

import { ClassChip, num } from "./ResultsView";

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const cm = (mm: number) => `${num(mm / 10, 1)} cm`;

/** Small yearly-mean line (stored values only), with a zero line for the 2004–2009 average. */
function Spark({ years }: { years: { year: number; mm: number }[] }) {
  if (years.length < 3) return null;
  const W = 320, H = 70, pad = 4;
  const lo = Math.min(0, ...years.map((y) => y.mm)), hi = Math.max(0, ...years.map((y) => y.mm));
  const x = (i: number) => pad + (i / (years.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const d = years.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.mm).toFixed(1)}`).join(" ");
  return (
    <Box component="svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Yearly mean water storage ${years[0]!.year}–${years.at(-1)!.year}`} sx={{ width: "100%", maxWidth: 360, height: "auto", display: "block" }}>
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke={tokens.neutral[400]} strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={tokens.forest[600]} strokeWidth={2} />
      <text x={pad} y={H - 1} fontSize="9" fill={tokens.neutral[600]}>{years[0]!.year}</text>
      <text x={W - pad} y={H - 1} fontSize="9" fill={tokens.neutral[600]} textAnchor="end">{years.at(-1)!.year}</text>
    </Box>
  );
}

/** Regional water storage from NASA GRACE / GRACE-FO, as context for the whole region (not the field). */
export function GraceCard({ grace }: { grace: GraceContext | null }) {
  if (!grace) return null;
  const s = grace.summary;
  const falling = s.trendMmPerYear != null && s.trendMmPerYear < 0;
  return (
    <Box component="section" aria-labelledby="grace-h" sx={{ mb: 2.5, p: { xs: 1.5, md: 2 }, borderRadius: `${radius.md}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 1 }}>
        <Typography id="grace-h" component="h3" sx={{ fontWeight: 700 }}>
          Water stored in this region (NASA GRACE satellites)
        </Typography>
        <ClassChip kind="observed" />
      </Stack>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {s.trendMmPerYear != null && (
          <>
            Across a region about 300 km wide around your field, the water held in soil, groundwater and rivers has {falling ? "fallen" : "risen"} by about <strong>{cm(Math.abs(s.trendMmPerYear))} a year</strong> since {s.firstMonth.slice(0, 4)}
            {s.change ? ` (${s.change.toYears[0]}–${s.change.toYears[1]} compared with ${s.change.fromYears[0]}–${s.change.fromYears[1]}: ${s.change.mm < 0 ? "" : "+"}${cm(s.change.mm)})` : ""}.{" "}
          </>
        )}
        {s.seasonal && (
          <>
            Each year it is <strong>lowest around {MONTH[s.seasonal.lowMonth - 1]}</strong> and highest around {MONTH[s.seasonal.highMonth - 1]} (an average swing of {cm(s.seasonal.swingMm)}).
          </>
        )}
      </Typography>
      <Spark years={s.years} />
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        Yearly mean against the 2004–2009 average (dashed). Latest month {s.latest.month}: {s.latest.mm < 0 ? "" : "+"}{cm(s.latest.mm)} ± {s.latest.uncertaintyMm != null ? cm(s.latest.uncertaintyMm) : "unknown"}. Regional context only: GRACE senses total water over about 300 km, not your field or well, and cannot tell pumping from drought. Source: {grace.source.name}, granule {grace.source.granule}, doi:{grace.source.doi}; land scale factor {grace.cell.scale} applied. {s.validMonths} monthly solutions, {s.firstMonth} to {s.lastMonth}; months without a solution (including the 2017–2018 gap between the missions) are left out, never filled.
      </Typography>
    </Box>
  );
}
