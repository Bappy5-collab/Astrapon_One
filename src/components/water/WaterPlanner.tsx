"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { More, Section } from "@/components/farm/ui";
import { SceneShell } from "@/components/field3d/FieldViewport";
import { SceneErrorBoundary } from "@/components/scene/SceneErrorBoundary";
import { SceneMessage } from "@/components/scene/SceneMessage";
import { detectGraphicsCapability, type GraphicsCapability } from "@/components/scene/webgl";
import type { BoundaryGeometry, Position } from "@/domain/geo/boundary";
import { OUTCOME_TEXT, depthBelowGround, type RankedStation } from "@/domain/water/groundwater";
import { ATTAINABLE_APPLICATION_EFFICIENCY, METHOD_LABELS, type IrrigationMethod, type RunDemand } from "@/domain/water/demand";
import { needInMonths, type DrySeasonOutlook } from "@/domain/water/dryseason";
import type { GraceContext } from "@/domain/water/grace";
import { computeWaterEnergy, type InputBasis
, type PlannerInput, type PlannerResult } from "@/domain/water/plan";
import { WaterInputError } from "@/domain/water/pump";
import { CATEGORY_LABEL, distanceMeaning, type MappedSource } from "@/domain/water/surface";

/** Marks a map-service failure so the planner can show plain words in the farmer's language, not the provider's error. */
const SURFACE_SERVICE_BUSY = "provider_error";
import { useT } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";
import { useReducedMotion } from "@/lib/preferences";
import type { GroundwaterLookup, SolarOutcome, SurfaceLookup } from "@/domain/water/lookup-types";
import { color, radius, tokens } from "@/theme/tokens";

import { GraceCard } from "./GraceCard";
import { ClassChip } from "./ClassChip";
import { ResultsView } from "./ResultsBody";
import { useWaterFmt } from "./useWaterFmt";
import type { WaterPart } from "./WaterScene";

function MapLoading() {
  const t = useT();
  return <SceneMessage title={t("app.water.p.loadingMap")} busy />;
}
function SceneLoading() {
  const t = useT();
  return <SceneMessage title={t("app.water.p.loadingScene")} busy />;
}
const WaterMapGL = dynamic(() => import("./WaterMapGL"), { ssr: false, loading: () => <MapLoading /> });
const WaterScene = dynamic(() => import("./WaterScene"), { ssr: false, loading: () => <SceneLoading /> });

type ActionErr = { ok: false; message: string; auth?: boolean };
export type PlannerActions = {
  surface: (radiusM: number) => Promise<SurfaceLookup | ActionErr>;
  groundwater: (radiusM: number) => Promise<GroundwaterLookup | ActionErr>;
  solar: () => Promise<SolarOutcome | ActionErr>;
  save: (raw: unknown) => Promise<{ ok: true; id: string; version: number; message: string } | ActionErr>;
};
export type RunChoice = { runId: string; resultSha256: string; scenarioName: string; finishedAt: string | null; demand: RunDemand };

type Load<T> = { state: "idle" | "loading" | "done" | "error"; data?: T; error?: string; at?: number };
const isErr = (v: unknown): v is ActionErr => typeof v === "object" && v != null && (v as { ok?: unknown }).ok === false && "message" in (v as object) && !("reason" in (v as object));

/** A numeric text field kept as text; parsed with `parse`. */
const parse = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));


/** Weather-based dry-season outlook with plain next steps. Modelled indicator, never an observation of the water body. */
function DryOutlook({ outlook, fieldId, needs, applied, onUse }: { outlook: OutlookProp; fieldId: string; needs: { label: string; m3: number | null; gross: boolean }[]; applied: boolean; onUse: (months: number[]) => void }) {
  const t = useT();
  const w = useWaterFmt();
  const num = w.num;
  const box = { mt: 2.5, p: { xs: 1.5, md: 2 }, borderRadius: `${radius.md}px`, border: `1px solid ${tokens.forest[400]}`, bgcolor: color.surfaceRaised };
  const head = (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, mb: 1 }}>
      <Typography component="h3" sx={{ fontWeight: 700 }}>
        {t("app.water.dry.title")}
      </Typography>
      <ClassChip kind="modelled" />
    </Stack>
  );
  if (!outlook)
    return (
      <Box sx={box}>
        {head}
        <Typography variant="body2">
          {t("app.water.dry.noWeather")} <a href={`/fields/${fieldId}/evidence`}>{t("app.water.dry.getWeather")}</a>{t("app.water.dry.comeBack")}
        </Typography>
      </Box>
    );
  if (outlook.status !== "ok")
    return (
      <Box sx={box}>
        {head}
        <Typography variant="body2">{outlook.reason}</Typography>
      </Box>
    );
  const src = fmt(t(outlook.rainSource === "gpm-imerg-final" ? "app.water.dry.srcImergFinal" : outlook.rainSource === "gpm-imerg-late" ? "app.water.dry.srcImergLate" : "app.water.dry.src"), { from: w.digits(outlook.period!.from.slice(0, 4)), to: w.digits(outlook.period!.to.slice(0, 4)), n: w.int(outlook.period!.completeYears), date: w.date((outlook.rainRetrievedAt ?? outlook.retrievedAt).slice(0, 10)) });
  if (outlook.noDrySeason)
    return (
      <Box sx={box}>
        {head}
        <Typography variant="body2">{fmt(t("app.water.dry.none"), { src })}</Typography>
      </Box>
    );
  const dm = outlook.dryMonths;
  const first = w.monthShort(dm[0]!), last = w.monthShort(dm[dm.length - 1]!);
  const low = outlook.lowestMonth ? w.monthList([outlook.lowestMonth]) : null;
  const hardest = outlook.hardestSeason ? (outlook.hardestSeason.startYear === outlook.hardestSeason.endYear ? w.digits(String(outlook.hardestSeason.startYear)) : w.digits(`${outlook.hardestSeason.startYear}–${String(outlook.hardestSeason.endYear).slice(2)}`)) : null;
  const known = needs.filter((x) => x.m3 != null);
  const least = known.length > 1 ? known.reduce((a, b) => (b.m3! < a.m3! ? b : a)) : null;
  return (
    <Box sx={box}>
      {head}
      <Typography variant="body2" sx={{ mb: 1 }}>
        {t("app.water.dry.s1")} <strong>{fmt(t("app.water.dry.runs"), { first, last })}</strong> {fmt(t(dm.length > 1 ? "app.water.dry.months" : "app.water.dry.month1"), { n: w.int(dm.length) })} {t("app.water.dry.s2")} <strong>{fmt(t("app.water.dry.lowest"), { low: low ?? "—" })}</strong>.
        {hardest ? ` ${fmt(t("app.water.dry.hardest"), { season: hardest })}` : ""}
      </Typography>
      <Box component="details" sx={{ mb: 1 }}>
        <Box component="summary" sx={{ cursor: "pointer", fontWeight: 600, color: tokens.forest[600] }}>
          {t("app.water.monthByMonth")}
        </Box>
        <Box sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ borderCollapse: "collapse", mt: 1, fontSize: "0.85rem", "& td, & th": { px: 1, py: 0.5, borderBottom: `1px solid ${color.line}`, textAlign: "right", whiteSpace: "nowrap" }, "& th:first-of-type, & td:first-of-type": { textAlign: "left" } }}>
            <thead>
              <tr>
                <th>{t("app.water.month")}</th>
                <th>{t("app.water.dry.colRain")}</th>
                <th>{t("app.water.dry.colEt0")}</th>
                <th>{t("app.water.dry.colDryYears")}</th>
                <th>{t("app.water.dry.colDeficit")}</th>
              </tr>
            </thead>
            <tbody>
              {outlook.months.map((m) => (
                <tr key={m.month} style={m.dry ? { fontWeight: 600 } : undefined}>
                  <td>
                    {w.monthShort(m.month)}
                    {m.dry ? ` · ${t("app.water.dry.dry")}` : ""}
                  </td>
                  <td>{num(m.medianPrecipMm, 0)}</td>
                  <td>{num(m.medianEt0Mm, 0)}</td>
                  <td>
                    {fmt(t("app.water.dry.ofYears"), { n: w.int(m.dryYears), of: w.int(m.years) })}
                  </td>
                  <td>{m.cumulativeDeficitMm == null ? "—" : num(m.cumulativeDeficitMm, 0)}</td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      </Box>
      <Typography component="h4" variant="subtitle2">
        {t("app.water.dry.whatToDo")}
      </Typography>
      <Box component="ol" sx={{ mt: 0.5, mb: 1, pl: 3, "& li": { mb: 0.5 } }}>
        <li>
          {fmt(t("app.water.dry.do1"), { first, last })} <Button size="small" variant={applied ? "outlined" : "contained"} onClick={() => onUse(dm)} sx={{ ml: 0.5 }}>{applied ? t("app.water.dry.using") : t("app.water.dry.use")}</Button>
        </li>
        <li>{fmt(t("app.water.dry.do2"), { low: low ?? "—" })}</li>
        {known.length > 0 && (
          <li>
            {fmt(t("app.water.dry.do3"), { first, last })}
            {known[0]!.gross ? "" : ` ${t("app.water.dry.net")}`}: {known.map((x) => `${x.label} ${num(x.m3, 0)} m³/yr`).join("; ")}.
            {least ? ` ${fmt(t("app.water.dry.least"), { label: least.label })}` : ""} {fmt(t("app.water.dry.store"), { first })}
          </li>
        )}
        <li>{fmt(t("app.water.dry.do4"), { first })}</li>
      </Box>
      <Typography variant="caption" color="text.secondary" component="p">
        {fmt(t("app.water.dry.caption"), { src })}
      </Typography>
    </Box>
  );
}

/** A comparison can give a water need only when at least one option has one. */
const runUsable = (r: RunChoice) => r.demand.options.some((o) => !o.unavailable);

/** Labelled starting values for the pump, pipe and solar inputs (stated assumptions, editable). */
const STARTING = { diameter: "50", kLow: "2", kHigh: "6", eta: "45", runtime: "6", pr: "75", ctrl: "95", deliveryAboveGround: "1" };
const LIFT_KEYS = new Set(["aboveWater", "aboveWell", "measured", "hypothetical", "proxy", "drawdown", "bkMonths", "bkLevel", "bkHypothetical", "bkDrawdown", "bkAboveWell", "bkPipe"]);
const DEMAND_KEYS = new Set(["run", "runEmpty", "manual", "app", "conv"]);
const PUMP_KEYS = new Set(["pipe", "diameter", "k", "eta", "hours", "pr", "ctrl", "pressure", "existingPv"]);

/** "What to do on this page" in five plain steps, each ticked as soon as its inputs are complete. */
function PlannerChecklist({ items }: { items: { href: string; label: string; done: boolean }[] }) {
  const t = useT();
  const left = items.filter((i) => !i.done).length;
  return (
    <Box component="nav" aria-label={t("app.water.ck.title")} sx={{ mb: 2.5, p: { xs: 1.5, md: 2 }, borderRadius: `${radius.lg}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised }}>
      <Typography component="h2" sx={{ fontWeight: 700, mb: 0.25 }}>
        {t("app.water.ck.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
        {left ? t("app.water.ck.intro") : t("app.water.ck.allDone")}
      </Typography>
      <Box component="ol" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(5, 1fr)" } }}>
        {items.map((i, n) => (
          <Box component="li" key={i.label}>
            <Box
              component="a"
              href={i.href}
              sx={{ position: "relative", display: "flex", gap: 1, alignItems: "center", p: 1, height: "100%", borderRadius: `${radius.md}px`, textDecoration: "none", color: "inherit", border: `1px solid ${i.done ? tokens.forest[400] : color.line}`, bgcolor: i.done ? color.surface : "transparent", "&:hover": { borderColor: tokens.forest[600] } }}
            >
              <Box aria-hidden sx={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, bgcolor: i.done ? tokens.forest[600] : color.surface, color: i.done ? color.surfaceRaised : "text.secondary", border: i.done ? 0 : `1px solid ${color.line}` }}>
                {i.done ? "\u2713" : n + 1}
              </Box>
              <Typography variant="body2" sx={{ fontWeight: i.done ? 400 : 600 }}>
                {i.label}
                <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
                  {i.done ? ` (${t("app.water.ck.done")})` : ` (${t("app.water.ck.todo")})`}
                </Box>
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Num({ label, value, onChange, unit, helper, width = 170, id }: { label: string; value: string; onChange: (v: string) => void; unit?: string; helper?: string; width?: number; id?: string }) {
  const t = useT();
  const bad = value.trim() !== "" && parse(value) == null;
  return (
    <TextField
      id={id}
      label={unit ? `${label} (${unit})` : label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      size="small"
      inputMode="decimal"
      error={bad}
      helperText={bad ? t("app.water.p.enterNumber") : helper}
      sx={{ width: { xs: "100%", sm: width } }}
    />
  );
}

const RADII_SURFACE = [1000, 3000, 5000, 10000];
const RADII_GW = [5000, 10000, 25000];
const PIPE_MATERIALS = [
  { id: "pvc", eps: 0.0015 },
  { id: "steel", eps: 0.045 },
  { id: "galv", eps: 0.15 },
  { id: "cast", eps: 0.26 },
] as const;

let cachedCap: GraphicsCapability | undefined;
const noSubscribe = () => () => {};
const getCap = () => (cachedCap ??= detectGraphicsCapability());


export type OutlookProp = (DrySeasonOutlook & { retrievalId: string; retrievedAt: string; rainSource?: "gpm-imerg-final" | "gpm-imerg-late" | "nasa-power-daily"; rainRetrievedAt?: string }) | null;

export function WaterPlanner({ fieldId, fieldName, boundary, areaHa, runs, initialRunId, actions, outlook = null, grace = null }: { fieldId: string; fieldName: string; boundary: BoundaryGeometry; areaHa: number; runs: RunChoice[]; initialRunId: string | null; actions: PlannerActions; outlook?: OutlookProp; grace?: GraceContext | null }) {
  const t = useT();
  const w = useWaterFmt();
  const { num, km } = w;
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  // MapLibre needs WebGL2; without it the lists below are the full, usable view.
  const capability = useSyncExternalStore<GraphicsCapability | null>(noSubscribe, getCap, () => null);
  const mapUnavailable = <SceneMessage title={t("app.water.p.mapUnavailable")} body={t("app.water.p.mapUnavailableBody")} />;

  // ------------------------------------------------------------- lookups ---
  const [surfaceRadius, setSurfaceRadius] = useState(3000);
  const [gwRadius, setGwRadius] = useState(10000);
  const [surface, setSurface] = useState<Load<Extract<SurfaceLookup, { ok: true }>>>({ state: "loading" });
  const [gw, setGw] = useState<Load<Extract<GroundwaterLookup, { ok: true }>>>({ state: "loading" });
  const [solar, setSolar] = useState<Load<Extract<SolarOutcome, { ok: true }>>>({ state: "loading" });
  const seq = useRef({ surface: 0, gw: 0, solar: 0 });
  const [authLost, setAuthLost] = useState(false);

  const runLookup = useCallback(
    async <T,>(kind: "surface" | "gw" | "solar", call: () => Promise<T | ActionErr>, set: (l: Load<never> | Load<T>) => void, okOf: (v: T) => { ok: true; value: T } | { ok: false; message: string }, markLoading = true) => {
      const id = ++seq.current[kind];
      if (markLoading) set({ state: "loading" });
      try {
        const res = await call();
        if (id !== seq.current[kind]) return; // a newer request (other radius/field) superseded this one
        if (isErr(res)) {
          if (res.auth) setAuthLost(true);
          set({ state: "error", error: res.message });
          return;
        }
        const r = okOf(res as T);
        set(r.ok ? { state: "done", data: r.value, at: Date.now() } : { state: "error", error: r.message });
      } catch {
        if (id === seq.current[kind]) set({ state: "error", error: t("app.water.p.requestFailed") });
      }
    },
    [t],
  );

  const loadSurface = useCallback((r: number, markLoading = true) => runLookup("surface", () => actions.surface(r), setSurface as never, (v: SurfaceLookup) => (v.ok ? { ok: true, value: v } : { ok: false, message: v.reason === "provider_error" ? SURFACE_SERVICE_BUSY : v.message }), markLoading), [actions, runLookup]);
  const loadGw = useCallback((r: number, markLoading = true) => runLookup("gw", () => actions.groundwater(r), setGw as never, (v: GroundwaterLookup) => (v.ok ? { ok: true, value: v } : { ok: false, message: v.message }), markLoading), [actions, runLookup]);
  const loadSolar = useCallback((markLoading = true) => runLookup("solar", () => actions.solar(), setSolar as never, (v: SolarOutcome) => (v.ok ? { ok: true, value: v } : { ok: false, message: v.error }), markLoading), [actions, runLookup]);

  // A new field (or boundary) starts a clean planner and new lookups; selections from another field are dropped.
  const fieldKey = useMemo(() => `${fieldId}:${JSON.stringify(boundary).length}:${JSON.stringify(boundary).slice(0, 80)}`, [fieldId, boundary]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedWell, setSelectedWell] = useState<string | null>(null);
  // The page remounts this component per field (key), so selections never carry over between fields.
  useEffect(() => {
    // Lookups run automatically for the field's location; slow providers never block the rest of the page.
    // Initial state is already "loading"; results arrive asynchronously.
    // Deferred one tick so a development double-mount sends each request once.
    const t = setTimeout(() => {
      void loadGw(10000, false);
      void loadSolar(false);
      void loadSurface(3000, false);
    }, 0);
    return () => clearTimeout(t);
  }, [fieldKey, loadGw, loadSolar, loadSurface]);

  // ------------------------------------------------------------- inputs ---
  const [sourceKind, setSourceKind] = useState<"surface" | "well">("surface");
  const [farmerSource, setFarmerSource] = useState<{ on: boolean; label: string; distance: string }>({ on: false, label: "", distance: "" });
  const [depthMode, setDepthMode] = useState<"measured" | "proxy" | "hypothetical" | "unknown">("unknown");
  const [levelKind, setLevelKind] = useState<"pumping" | "static_plus_drawdown">("pumping");
  const [depthLow, setDepthLow] = useState("");
  const [depthHigh, setDepthHigh] = useState("");
  const [ddLow, setDdLow] = useState("");
  const [ddHigh, setDdHigh] = useState("");
  const [deliveryAboveGround, setDeliveryAboveGround] = useState(STARTING.deliveryAboveGround);
  const [aboveWaterLow, setAboveWaterLow] = useState("");
  const [aboveWaterHigh, setAboveWaterHigh] = useState("");
  const [pressure, setPressure] = useState("0");
  const [pipeLow, setPipeLow] = useState("");
  const [pipeHigh, setPipeHigh] = useState("");
  const [pipeBasis, setPipeBasis] = useState<InputBasis>("farmer_report");
  const [diameter, setDiameter] = useState(STARTING.diameter);
  const [material, setMaterial] = useState("pvc");
  const [kLow, setKLow] = useState(STARTING.kLow);
  const [kHigh, setKHigh] = useState(STARTING.kHigh);
  const [eta, setEta] = useState(STARTING.eta);
  const [runtime, setRuntime] = useState(STARTING.runtime);
  const [pr, setPr] = useState(STARTING.pr);
  const [ctrl, setCtrl] = useState(STARTING.ctrl);
  const [solarMode, setSolarMode] = useState<"size" | "evaluate">("size");
  const [existingKwp, setExistingKwp] = useState("");
  const [capacity, setCapacity] = useState("");
  const [budget, setBudget] = useState("");
  const [tank, setTank] = useState("");
  // Dry-season groundwater backup (model 1.1.0): months when the pond/river cannot be used.
  const [bkOn, setBkOn] = useState(false);
  const [bkMonths, setBkMonths] = useState<number[]>([]);
  /** True while the backup months are exactly the weather-based suggestion the farmer accepted. */
  const [bkFromOutlook, setBkFromOutlook] = useState(false);
  const [bkLabel, setBkLabel] = useState("");
  const [bkMode, setBkMode] = useState<"measured" | "hypothetical">("measured");
  const [bkLevelKind, setBkLevelKind] = useState<"pumping" | "static_plus_drawdown">("pumping");
  const [bkDepthLow, setBkDepthLow] = useState("");
  const [bkDepthHigh, setBkDepthHigh] = useState("");
  const [bkDdLow, setBkDdLow] = useState("");
  const [bkDdHigh, setBkDdHigh] = useState("");
  const [bkDeliv, setBkDeliv] = useState("1");
  const [bkPipeLow, setBkPipeLow] = useState("");
  const [bkPipeHigh, setBkPipeHigh] = useState("");
  const [bkCap, setBkCap] = useState("");

  // Start on a comparison only when one can give a water need; otherwise start on "Enter my own".
  const anyUsableRun = runs.some(runUsable);
  const [demandMode, setDemandMode] = useState<"run" | "manual">(anyUsableRun ? "run" : "manual");
  // Without a requested comparison, start from the newest one that has at least one option to plan for.
  const [runId, setRunId] = useState<string | null>(initialRunId && runs.some((r) => r.runId === initialRunId) ? initialRunId : (runs.find(runUsable) ?? runs[0])?.runId ?? null);
  const [manualDaily, setManualDaily] = useState("");
  const [manualMonths, setManualMonths] = useState<number[]>([]);
  const [manualBasis, setManualBasis] = useState<"farmer_report" | "hypothetical_input">("farmer_report");
  const [method, setMethod] = useState<IrrigationMethod | "own">("furrow");
  const [ownEff, setOwnEff] = useState("");
  const [conveyance, setConveyance] = useState("100");
  const [part, setPart] = useState<WaterPart | null>(null);
  const [view, setView] = useState<"map" | "3d">("map");
  const [basemap, setBasemap] = useState<"satellite" | "streets">("satellite");

  // Starting values are filled in from the start and named on the page (never silent); boxes the
  // farmer empties can be refilled with the button.
  const startingEmpty = [diameter, kLow, kHigh, eta, runtime, pr, ctrl].some((v) => !v.trim());
  const applyStarting = () => {
    if (!diameter) setDiameter(STARTING.diameter);
    if (!kLow) setKLow(STARTING.kLow);
    if (!kHigh) setKHigh(STARTING.kHigh);
    if (!eta) setEta(STARTING.eta);
    if (!runtime) setRuntime(STARTING.runtime);
    if (!pr) setPr(STARTING.pr);
    if (!ctrl) setCtrl(STARTING.ctrl);
    if (!deliveryAboveGround) setDeliveryAboveGround(STARTING.deliveryAboveGround);
  };

  const surfaceData = surface.data;
  const chosenSource: MappedSource | null = surfaceData?.sources.find((s) => s.id === selectedSource) ?? null;
  const stations = gw.data?.stations ?? [];
  const chosenWell: RankedStation | null = stations.find((s) => `${s.provider}:${s.stationId}` === selectedWell) ?? null;
  const run = runs.find((r) => r.runId === runId) ?? null;

  // Proxy: the selected station's depth below ground over the returned observations (min–max), derived only when compatible.
  const proxy = useMemo(() => {
    if (!chosenWell) return null;
    const depths = chosenWell.measurements.map((m) => ({ m, d: depthBelowGround(m, chosenWell) })).filter((x) => x.d != null);
    if (!depths.length) return { ok: false as const, why: chosenWell.measurements.length ? t("app.water.p.proxyNoDepth") : t("app.water.p.proxyNoObs") };
    const recent = depths.slice(0, 20);
    const vals = recent.map((x) => x.d!.depthM);
    const derived = recent.find((x) => x.d!.derived)?.d;
    return { ok: true as const, low: Math.min(...vals), high: Math.max(...vals), latest: recent[0]!, count: recent.length, derivation: derived && "method" in derived ? derived.method : null };
  }, [chosenWell, t]);

  /** Selecting a mapped source pre-fills the route length with the straight-line distance as a labelled minimum, unless the farmer typed a route. */
  const chooseSource = (id: string) => {
    setSourceKind("surface");
    setSelectedSource(id);
    setFarmerSource((f) => ({ ...f, on: false }));
    const s = surface.data?.sources.find((x) => x.id === id);
    if (s && (pipeBasis !== "farmer_report" || (!pipeLow && !pipeHigh))) {
      const d = String(Math.max(1, Math.round(s.distanceM)));
      setPipeLow(d);
      setPipeHigh(d);
      setPipeBasis("mapped_feature");
    }
  };

  // ------------------------------------------------------------ planner input ---
  const built = useMemo((): { input: PlannerInput | null; missing: string[]; keys: string[] } => {
    const missing: string[] = [];
    const keys: string[] = [];
    const miss = (k: string) => {
      keys.push(k);
      missing.push(t(`app.water.miss.${k}` as MessageKey));
    };
    const n = parse;
    const range = (lo: string, hi: string, name: string) => {
      const a = n(lo), b = n(hi === "" ? lo : hi);
      if (a == null || b == null) { miss(name); return null; }
      return { low: Math.min(a, b), high: Math.max(a, b) };
    };
    // demand
    let demand: PlannerInput["demand"] | null = null;
    if (demandMode === "run") {
      if (!run) miss("run");
      else if (!runUsable(run)) miss("runEmpty");
      else demand = { mode: "run", runId: run.runId, resultSha256: run.resultSha256, runKind: "historical_replay", options: run.demand.options.slice(0, 5) };
    } else {
      const d = n(manualDaily);
      if (d == null || !manualMonths.length) miss("manual");
      else demand = { mode: "manual", basis: manualBasis, dailyGrossM3: d, months: [...manualMonths].sort((a, b) => a - b), year: 2024 };
    }
    const app = method === "own" ? n(ownEff) : ATTAINABLE_APPLICATION_EFFICIENCY[method][0] * 100;
    if (app == null) miss("app");
    const conv = n(conveyance);
    if (conv == null) miss("conv");
    // lift
    let lift: PlannerInput["lift"] | null = null;
    if (sourceKind === "surface") {
      const r = range(aboveWaterLow, aboveWaterHigh, "aboveWater");
      if (r) lift = { kind: "surface", deliveryAboveWaterM: r, basis: "farmer_report" };
    } else {
      const dag = n(deliveryAboveGround);
      if (dag == null) miss("aboveWell");
      let depth: { low: number; high: number } | null = null;
      let basis: InputBasis = "farmer_report";
      let lk = levelKind;
      let proxyRef: Extract<PlannerInput["lift"], { kind: "well" }>["proxy"] = null;
      if (depthMode === "measured") depth = range(depthLow, depthHigh, "measured");
      else if (depthMode === "hypothetical") { depth = range(depthLow, depthHigh, "hypothetical"); basis = "hypothetical_input"; }
      else if (depthMode === "proxy") {
        if (!chosenWell || !proxy?.ok) miss("proxy");
        else {
          depth = { low: proxy.low, high: proxy.high };
          basis = "ground_measurement_proxy";
          lk = chosenWell.measurements[0]?.levelState === "pumping" ? "pumping" : "static_plus_drawdown";
          proxyRef = { provider: chosenWell.provider, stationId: chosenWell.stationId, stationName: `${chosenWell.name} (${chosenWell.authority})`, distanceM: chosenWell.distanceM, observedAt: proxy.latest.m.time, originalValue: proxy.latest.m.originalValue, originalUnit: proxy.latest.m.originalUnit, derivation: proxy.derivation };
        }
      }
      const dd = lk === "static_plus_drawdown" && depthMode !== "unknown" ? range(ddLow, ddHigh, "drawdown") : null;
      if (dag != null) lift = { kind: "well", levelKind: lk, depthM: depthMode === "unknown" ? null : depth, drawdownM: dd, deliveryAboveGroundM: dag, basis, proxy: proxyRef };
      if (depthMode !== "unknown" && !depth) lift = null;
    }
    const pipeLen = range(pipeLow, pipeHigh, "pipe");
    const dia = n(diameter);
    if (dia == null) miss("diameter");
    const k = range(kLow, kHigh, "k");
    const e = n(eta), rt = n(runtime), p = n(pr), c = n(ctrl), pk = n(pressure);
    if (e == null) miss("eta");
    if (rt == null) miss("hours");
    if (p == null) miss("pr");
    if (c == null) miss("ctrl");
    if (pk == null) miss("pressure");
    if (solarMode === "evaluate" && n(existingKwp) == null) miss("existingPv");
    let backup: PlannerInput["backup"] = null;
    if (sourceKind === "surface" && bkOn) {
      if (!bkMonths.length) miss("bkMonths");
      const lk = bkMode === "hypothetical" ? "static_plus_drawdown" : bkLevelKind;
      const bd = range(bkDepthLow, bkDepthHigh, bkMode === "measured" ? "bkLevel" : "bkHypothetical");
      const bdd = lk === "static_plus_drawdown" ? range(bkDdLow, bkDdHigh, "bkDrawdown") : null;
      const bdel = n(bkDeliv);
      if (bdel == null) miss("bkAboveWell");
      const bpipe = range(bkPipeLow, bkPipeHigh, "bkPipe");
      if (bkMonths.length && bd && (lk === "pumping" || bdd) && bdel != null && bpipe)
        backup = {
          months: [...bkMonths].sort((a, b) => a - b),
          monthsBasis: bkFromOutlook ? "simulation_output" : "farmer_report",
          label: bkLabel.trim() || "Backup tube well",
          lift: { kind: "well", levelKind: lk, depthM: bd, drawdownM: bdd, deliveryAboveGroundM: bdel, basis: bkMode === "measured" ? "farmer_report" : "hypothetical_input", proxy: null },
          pipe: { lengthM: bpipe, lengthBasis: "farmer_report" },
          capacityM3PerDay: n(bkCap),
        };
    }
    if (missing.length || !demand || !lift || !pipeLen || !k || app == null || conv == null || dia == null || e == null || rt == null || p == null || c == null || pk == null) return { input: null, missing, keys };
    const sourceRef = sourceKind === "surface" && chosenSource ? { provider: "OpenStreetMap", id: chosenSource.id, type: CATEGORY_LABEL[chosenSource.category], url: chosenSource.url, mappedAt: chosenSource.lastEdited } : sourceKind === "well" && chosenWell && depthMode === "proxy" ? { provider: chosenWell.provider, id: chosenWell.stationId, type: "monitoring well (proxy)", url: chosenWell.recordUrl, mappedAt: null } : null;
    return {
      missing,
      keys,
      input: {
        schema: 1,
        areaHa,
        demand,
        efficiency: { application: app / 100, applicationBasis: method === "own" ? "farmer_report" : "default_assumption", method: method === "own" ? null : `${METHOD_LABELS[method]}: lower end of the attainable range (FAO W4367E, Keller 1992)`, conveyance: conv / 100, conveyanceBasis: conveyance === "100" ? "default_assumption" : "farmer_report" },
        source: {
          kind: sourceKind,
          label: sourceKind === "surface" ? (farmerSource.on ? farmerSource.label || "Farmer-reported source" : chosenSource ? `${chosenSource.name ?? CATEGORY_LABEL[chosenSource.category]}` : "Surface source (not selected)") : "Well",
          basis: sourceKind === "surface" ? (farmerSource.on ? "farmer_report" : "mapped_feature") : depthMode === "proxy" ? "ground_measurement_proxy" : depthMode === "hypothetical" ? "hypothetical_input" : "farmer_report",
          ref: sourceRef,
          straightLineM: sourceKind === "surface" ? (farmerSource.on ? n(farmerSource.distance) : chosenSource?.distanceM ?? null) : null,
          geometryNote: chosenSource && sourceKind === "surface" ? `Distance ${distanceMeaning(chosenSource.role)}` : null,
        },
        lift,
        deliveryPressureKPa: pk,
        pipe: { lengthM: pipeLen, lengthBasis: pipeBasis, innerDiameterMm: dia, roughnessMm: PIPE_MATERIALS.find((m) => m.id === material)!.eps, minorLossK: k },
        pump: { etaPumpMotor: e / 100, runtimeHoursPerDay: rt },
        solar: { performanceRatio: p / 100, controllerEfficiency: c / 100, mode: solarMode, existingKwp: solarMode === "evaluate" ? n(existingKwp) : null, summary: solar.data ? solar.data.summary : null },
        supply: { capacityM3PerDay: n(capacity), seasonalBudgetM3: n(budget), basis: "farmer_report" },
        storage: { tankM3: n(tank) },
        constants: { rho: 1000, g: 9.81 },
        ...(backup ? { backup } : {}),
      },
    };
  }, [t, demandMode, run, manualDaily, manualMonths, manualBasis, method, ownEff, conveyance, sourceKind, aboveWaterLow, aboveWaterHigh, deliveryAboveGround, levelKind, depthMode, depthLow, depthHigh, chosenWell, proxy, ddLow, ddHigh, pipeLow, pipeHigh, diameter, kLow, kHigh, eta, runtime, pr, ctrl, pressure, solarMode, existingKwp, chosenSource, farmerSource, areaHa, pipeBasis, material, solar.data, capacity, budget, tank, bkOn, bkMonths, bkFromOutlook, bkLabel, bkMode, bkLevelKind, bkDepthLow, bkDepthHigh, bkDdLow, bkDdHigh, bkDeliv, bkPipeLow, bkPipeHigh, bkCap]);

  const dryMonthsList = outlook?.status === "ok" ? outlook.dryMonths : [];
  const dryNeedsMemo = (result: PlannerResult | null) => {
    if (!dryMonthsList.length) return [];
    if (result) return result.options.map((o) => ({ label: o.label, m3: needInMonths(o.months, dryMonthsList, Math.max(1, o.window?.years.length ?? 1)), gross: true }));
    if (demandMode === "run" && run && !run.demand.unavailable)
      return run.demand.options.map((o) => ({ label: o.label, m3: needInMonths(o.months.map((m) => ({ key: m.key, grossM3: m.netMm == null ? null : m.netMm * areaHa * 10 })), dryMonthsList, Math.max(1, o.window?.years.length ?? 1)), gross: false }));
    return [];
  };
  const computed = useMemo((): { result: PlannerResult | null; error: string | null } => {
    if (!built.input) return { result: null, error: null };
    try {
      return { result: computeWaterEnergy(built.input), error: null };
    } catch (e) {
      return { result: null, error: e instanceof WaterInputError ? e.message : t("app.water.p.calcFailed") };
    }
  }, [built.input, t]);

  const stale = surface.state === "loading" || gw.state === "loading" || solar.state === "loading";
  const best = computed.result?.options[0] ?? null;
  const pvForScene = best?.totals.requiredKwp?.high ?? (solarMode === "evaluate" ? parse(existingKwp) : null);
  const flowing = !!best?.totals.energyKWhPerYear && (best.totals.grossM3PerYear ?? 0) > 0;

  // ---------------------------------------------------------------- save ---
  const [name, setName] = useState("");
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dryNeeds = dryNeedsMemo(computed.result);
  const [saving, startSave] = useTransition();
  const save = () => {
    if (!built.input || !computed.result) return;
    const evidence = {
      surface: surface.data
        ? { search: { radiusM: surface.data.radiusM, ...surface.data.provider, found: surface.data.total, truncated: surface.data.truncated }, selected: chosenSource && sourceKind === "surface" && !farmerSource.on ? { id: chosenSource.id, name: chosenSource.name, category: chosenSource.category, role: chosenSource.role, distanceM: chosenSource.distanceM, intersects: chosenSource.intersects, lastEdited: chosenSource.lastEdited, url: chosenSource.url, tags: chosenSource.tags, fieldPoint: chosenSource.fieldPoint, sourcePoint: chosenSource.sourcePoint } : null, farmerSource: farmerSource.on ? { label: farmerSource.label, distanceM: parse(farmerSource.distance) } : null }
        : null,
      groundwater: gw.data
        ? { radiusM: gw.data.radiusM, fromDate: gw.data.fromDate, asOf: gw.data.asOf, countryHint: gw.data.countryHint, providers: gw.data.providers.map((p) => ({ id: p.id, name: p.name, consulted: p.consulted, outcome: p.outcome, message: p.message, stationsInRadius: p.stationsInRadius, licence: p.licence })), selected: chosenWell ? { provider: chosenWell.provider, stationId: chosenWell.stationId, authority: chosenWell.authority, name: chosenWell.name, distanceM: chosenWell.distanceM, aquifer: chosenWell.aquifer, wellDepthM: chosenWell.wellDepthM, groundElevation: chosenWell.groundElevation, recordUrl: chosenWell.recordUrl, retrievedAt: chosenWell.retrievedAt, measurements: chosenWell.measurements.slice(0, 20) } : null }
        : null,
      solar: solar.data ? solar.data.provenance : null,
    };
    startSave(async () => {
      const res = await actions.save({ name: name.trim() || fmt(t("app.water.p.defaultName"), { date: new Date().toISOString().slice(0, 10) }), inputs: built.input, evidence });
      if (!res.ok) {
        if ("auth" in res && res.auth) setAuthLost(true);
        setSaveMsg({ ok: false, text: res.message });
        return;
      }
      setSaveMsg({ ok: true, text: res.message });
      // Back to the field's steps, which now show this step done and what to do next.
      router.push(`/fields/${fieldId}/records?waterSaved=${res.version}`);
    });
  };

  // ---------------------------------------------------------------- render ---
  const sceneSource = sourceKind === "surface"
    ? chosenSource && !farmerSource.on
      ? { kind: "surface" as const, label: chosenSource.name ?? CATEGORY_LABEL[chosenSource.category], geometry: chosenSource.geometry, fieldPoint: chosenSource.fieldPoint, sourcePoint: chosenSource.sourcePoint, distanceM: chosenSource.distanceM }
      : farmerSource.on ? { kind: "surface" as const, label: farmerSource.label || t("app.water.p.yourSource"), geometry: null, fieldPoint: null, sourcePoint: null, distanceM: parse(farmerSource.distance) } : null
    : { kind: "well" as const, label: t("app.water.p.well"), geometry: null, fieldPoint: null, sourcePoint: null, distanceM: null };

  return (
    <Box>
      {authLost && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button href={`/sign-in?next=/fields/${fieldId}/water`}>{t("nav.signIn")}</Button>}>
          {t("app.water.p.sessionEnded")}
        </Alert>
      )}
      <PlannerChecklist
        items={[
          { href: "#water-source", label: t("app.water.ck.source"), done: sourceKind === "surface" ? Boolean(chosenSource || farmerSource.on) : Boolean(chosenWell || depthMode === "measured" || depthMode === "hypothetical") },
          { href: "#water-source", label: sourceKind === "surface" ? t("app.water.ck.height") : t("app.water.ck.depth"), done: !built.keys.some((k) => LIFT_KEYS.has(k)) },
          { href: "#water-demand", label: t("app.water.ck.need"), done: !built.keys.some((k) => DEMAND_KEYS.has(k)) },
          { href: "#water-pump", label: t("app.water.ck.pump"), done: !built.keys.some((k) => PUMP_KEYS.has(k)) },
          { href: "#water-result", label: t("app.water.ck.save"), done: Boolean(computed.result) },
        ]}
      />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.05fr) minmax(0, 1fr)" }, gap: 2.5, alignItems: "start" }}>
        {/* ------------------------------------------------ map / 3D ------ */}
        <Box sx={{ position: { lg: "sticky" }, top: { lg: 84 } }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label={t("app.water.p.view")}>
              <ToggleButton value="map">{t("ws.viewMap")}</ToggleButton>
              <ToggleButton value="3d">{t("app.water.p.schematic")}</ToggleButton>
            </ToggleButtonGroup>
            {view === "map" && (
              <ToggleButtonGroup size="small" exclusive value={basemap} onChange={(_, v) => v && setBasemap(v)} aria-label={t("ws.basemap")}>
                <ToggleButton value="satellite">{t("ws.satellite")}</ToggleButton>
                <ToggleButton value="streets">{t("ws.streets")}</ToggleButton>
              </ToggleButtonGroup>
            )}
            {stale && <Chip size="small" icon={<CircularProgress size={12} />} label={t("app.water.p.updating")} />}
          </Stack>
          <Box sx={{ position: "relative", height: { xs: 340, md: 460 }, borderRadius: `${radius.lg}px`, overflow: "hidden", border: `1px solid ${color.line}` }}>
            {view === "map" ? (
              capability == null ? (
                <SceneMessage title={t("app.water.p.checkingMap")} busy />
              ) : capability.support !== "webgl2" ? (
                mapUnavailable
              ) : (
              <SceneErrorBoundary fallback={() => mapUnavailable}>
              <WaterMapGL
                boundary={boundary}
                radiusM={sourceKind === "surface" ? surfaceRadius : gwRadius}
                sources={(surfaceData?.sources ?? []).map((s) => ({ id: s.id, geometry: s.geometry, label: s.name ?? CATEGORY_LABEL[s.category] }))}
                wells={stations.map((s) => ({ key: `${s.provider}:${s.stationId}`, lon: s.lon, lat: s.lat, label: s.name, tone: s.recency === "recent" ? "recent" : s.recency === "historical" ? "historical" : "none" }))}
                selectedSource={selectedSource}
                selectedWell={selectedWell}
                link={chosenSource && sourceKind === "surface" && !farmerSource.on ? { from: chosenSource.fieldPoint as Position, to: chosenSource.sourcePoint as Position } : null}
                basemap={basemap}
                onSelectSource={chooseSource}
                onSelectWell={(k) => { setSourceKind("well"); setSelectedWell(k); }}
                label={fmt(t("app.water.p.mapLabel"), { name: fieldName })}
              />
              </SceneErrorBoundary>
              )
            ) : (
              <SceneShell
                label={t("app.water.p.schematicLabel")}
                renderScene={(c) => <WaterScene {...c} boundary={boundary} source={sceneSource} pvKwp={pvForScene} tankM3={parse(tank)} flowing={flowing} reducedMotion={reducedMotion} selected={part} onSelect={setPart} />}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {fmt(t("app.water.p.mapLegend"), { r: km(sourceKind === "surface" ? surfaceRadius : gwRadius) })}
          </Typography>
          {view === "3d" && (
            <Box component="ul" aria-label={t("app.water.p.sceneParts")} sx={{ pl: 3, mt: 1, mb: 0 }}>
              <li>
                {t("app.water.p.partSource")} {sceneSource ? `${sceneSource.label}${sceneSource.distanceM != null ? `, ${fmt(t("app.water.p.straightLine"), { d: km(sceneSource.distanceM) })}` : ""}` : t("app.water.p.notChosen")}
              </li>
              <li>
                {t("app.water.p.partPipe")} {pipeLow ? `${w.digits(pipeLow)}${pipeHigh && pipeHigh !== pipeLow ? `–${w.digits(pipeHigh)}` : ""} m (${pipeBasis === "mapped_feature" ? t("app.water.p.straightMin") : pipeBasis === "farmer_report" ? t("app.water.p.yourRoute") : t("app.water.class.hypothetical")})` : t("app.water.p.notEntered")}
              </li>
              {sourceKind === "surface" && bkOn && (
                <li>
                  {t("app.water.p.partBackup")} {bkLabel.trim() || t("app.water.p.tubeWell")}
                  {bkMonths.length ? ` (${[...bkMonths].sort((a, b) => a - b).map((m) => w.monthShort(m)).join(", ")})` : ""}
                </li>
              )}
              <li>
                {t("app.water.p.partPv")} {pvForScene ? `${num(pvForScene, 2)} kWp` : t("app.water.p.notSized")}
              </li>
              <li>
                {t("app.water.p.partTank")} {parse(tank) ? `${w.digits(tank)} m³` : t("app.rec.none")}
              </li>
              {part && <li aria-live="polite">{t("app.water.p.selected")} {part}</li>}
            </Box>
          )}
        </Box>

        {/* ------------------------------------------------ steps ------ */}
        <Box sx={{ minWidth: 0 }}>
          <Section id="water-source" step={1} title={t("app.water.s1.title")} intro={t("app.water.s1.intro")}>
            <GraceCard grace={grace} />
            <ToggleButtonGroup exclusive value={sourceKind} onChange={(_, v) => v && setSourceKind(v)} aria-label={t("app.water.s1.sourceType")} sx={{ mb: 2 }}>
              <ToggleButton value="surface">{t("app.water.s1.surface")}</ToggleButton>
              <ToggleButton value="well">{t("app.water.s1.well")}</ToggleButton>
            </ToggleButtonGroup>

            {sourceKind === "surface" ? (
              <Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
                  <TextField select size="small" label={t("app.water.s1.searchWithin")} value={surfaceRadius} onChange={(e) => setSurfaceRadius(Number(e.target.value))} sx={{ width: 160 }}>
                    {RADII_SURFACE.map((r) => (
                      <MenuItem key={r} value={r}>
                        {fmt(t("app.water.s1.ofField"), { r: km(r) })}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button variant="outlined" onClick={() => void loadSurface(surfaceRadius)} disabled={surface.state === "loading"}>
                    {surface.state === "loading" ? t("loc.searching") : t("app.water.s1.searchWater")}
                  </Button>
                </Stack>
                {surface.state === "error" && (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>
                    {surface.error === SURFACE_SERVICE_BUSY ? t("app.water.s1.serviceBusy") : `${surface.error} ${t("app.water.s1.serviceProblem")}`}
                  </Alert>
                )}
                {surface.state === "done" && surfaceData && (
                  <>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {surfaceData.total
                        ? `${fmt(t("app.water.s1.found"), { n: w.int(surfaceData.total), r: km(surfaceData.radiusM) })}${surfaceData.total > surfaceData.sources.length ? ` ${fmt(t("app.water.s1.nearestShown"), { n: w.int(surfaceData.sources.length) })}` : ""}.`
                        : fmt(t("app.water.s1.noneFound"), { r: km(surfaceData.radiusM) })}
                      {surfaceData.truncated && ` ${t("app.water.s1.truncated")}`}
                    </Typography>
                    <RadioGroup value={farmerSource.on ? "" : selectedSource ?? ""} onChange={(e) => chooseSource(e.target.value)} aria-label={t("app.water.s1.mappedList")}>
                      <Box sx={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${color.line}`, borderRadius: `${radius.md}px`, px: 1.5 }}>
                        {surfaceData.sources.slice(0, 25).map((s) => (
                          <FormControlLabel
                            key={s.id}
                            value={s.id}
                            control={<Radio size="small" />}
                            sx={{ display: "flex", alignItems: "flex-start", my: 0.5, "& .MuiFormControlLabel-label": { pt: 0.75 } }}
                            label={
                              <Box>
                                <Typography component="span" sx={{ fontWeight: 600 }}>
                                  {s.name ?? t(`app.water.cat.${s.category}`)}
                                </Typography>{" "}
                                <Typography component="span" variant="body2" color="text.secondary">
                                  · {t(`app.water.cat.${s.category}`)} · {s.intersects ? t("app.water.s1.touches") : `${km(s.distanceM)} ${t(`app.water.role.${s.role}`)}`}
                                  {s.tags.intermittent === "yes" || s.tags.seasonal ? ` · ${t("app.water.s1.seasonal")}` : ""}
                                  {s.lastEdited ? ` · ${fmt(t("app.water.s1.edited"), { date: w.date(s.lastEdited.slice(0, 10)) })}` : ""}
                                </Typography>
                              </Box>
                            }
                          />
                        ))}
                      </Box>
                    </RadioGroup>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                      {fmt(t("app.water.s1.osm"), { host: surfaceData.provider.endpoint.replace(/^https:\/\//, "").split("/")[0] ?? "", asOf: surfaceData.provider.osmBase ? w.date(surfaceData.provider.osmBase.slice(0, 10)) : t("app.water.unknown"), at: `${w.date(surfaceData.provider.retrievedAt.slice(0, 10))} ${w.digits(surfaceData.provider.retrievedAt.slice(11, 16))}` })}
                    </Typography>
                  </>
                )}
                {surface.state === "loading" && <Typography variant="body2">{t("app.water.s1.searchingOsm")}</Typography>}
                <FormControlLabel sx={{ mt: 1 }} control={<Radio checked={farmerSource.on} onClick={() => setFarmerSource((f) => ({ ...f, on: !f.on }))} />} label={t("app.water.s1.notOnMap")} />
                {farmerSource.on && (
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 1 }}>
                    <TextField size="small" label={t("app.water.s1.nameDesc")} value={farmerSource.label} onChange={(e) => setFarmerSource((f) => ({ ...f, label: e.target.value }))} />
                    <Num label={t("app.water.s1.distance")} unit="m" value={farmerSource.distance} onChange={(v) => setFarmerSource((f) => ({ ...f, distance: v }))} helper={t("app.water.s1.distanceHelp")} />
                  </Stack>
                )}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
                  <Num label={t("app.water.s1.aboveLow")} unit="m" value={aboveWaterLow} onChange={setAboveWaterLow} helper={t("app.water.s1.aboveLowHelp")} width={240} />
                  <Num label={t("app.water.s1.aboveHigh")} unit="m" value={aboveWaterHigh} onChange={setAboveWaterHigh} helper={t("app.water.s1.aboveHighHelp")} width={240} />
                </Stack>

                <DryOutlook
                  outlook={outlook}
                  fieldId={fieldId}
                  needs={dryNeeds}
                  applied={bkOn && bkFromOutlook}
                  onUse={(months) => { setBkOn(true); setBkMonths(months); setBkFromOutlook(true); }}
                />
                <Box sx={{ mt: 2.5, p: { xs: 1.5, md: 2 }, borderRadius: `${radius.md}px`, border: `1px solid ${color.line}`, bgcolor: color.surface }}>
                  <FormControlLabel control={<Switch checked={bkOn} onChange={(e) => setBkOn(e.target.checked)} />} label={<Typography sx={{ fontWeight: 700 }}>{t("app.water.bk.title")}</Typography>} />
                  <Typography variant="body2" color="text.secondary" sx={{ mb: bkOn ? 1.5 : 0 }}>
                    {t("app.water.bk.intro")}
                  </Typography>
                  {bkOn && (
                    <Stack spacing={1.5}>
                      <Box>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                          {t("app.water.bk.months")}
                        </Typography>
                        <ToggleButtonGroup size="small" value={bkMonths} onChange={(_, v: number[]) => { setBkMonths(v); setBkFromOutlook(false); }} aria-label={t("app.water.bk.monthsAria")} sx={{ flexWrap: "wrap" }}>
                          {Array.from({ length: 12 }, (_, i) => (
                            <ToggleButton key={i} value={i + 1} sx={{ minWidth: 44 }}>
                              {w.monthShort(i + 1)}
                            </ToggleButton>
                          ))}
                        </ToggleButtonGroup>
                        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                          {bkFromOutlook ? t("app.water.bk.suggested") : t("app.water.bk.yourKnowledge")}
                        </Typography>
                      </Box>
                      <TextField size="small" label={t("app.water.bk.name")} value={bkLabel} onChange={(e) => setBkLabel(e.target.value)} sx={{ maxWidth: 360 }} />
                      <RadioGroup row value={bkMode} onChange={(e) => setBkMode(e.target.value as typeof bkMode)}>
                        <FormControlLabel value="measured" control={<Radio size="small" />} label={t("app.water.bk.knowLevel")} />
                        <FormControlLabel value="hypothetical" control={<Radio size="small" />} label={t("app.water.lvl.tryHypothetical")} />
                      </RadioGroup>
                      {bkMode === "measured" && (
                        <TextField select size="small" label={t("app.water.lvl.whatMeasured")} value={bkLevelKind} onChange={(e) => setBkLevelKind(e.target.value as typeof bkLevelKind)} sx={{ maxWidth: 360 }}>
                          <MenuItem value="pumping">{t("app.water.lvl.pumping")}</MenuItem>
                          <MenuItem value="static_plus_drawdown">{t("app.water.lvl.static")}</MenuItem>
                        </TextField>
                      )}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                        <Num label={bkMode === "measured" ? t("app.water.lvl.depth") : t("app.water.lvl.shallowest")} unit="m" value={bkDepthLow} onChange={setBkDepthLow} helper={t("app.water.bk.inDryMonths")} />
                        <Num label={t("app.water.lvl.deepestOpt")} unit="m" value={bkDepthHigh} onChange={setBkDepthHigh} helper={t("app.water.bk.lateDry")} />
                      </Stack>
                      {(bkMode === "hypothetical" || bkLevelKind === "static_plus_drawdown") && (
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                          <Num label={t("app.water.lvl.drawdownLow")} unit="m" value={bkDdLow} onChange={setBkDdLow} helper={t("app.water.bk.ddHelp")} width={230} />
                          <Num label={t("app.water.high")} unit="m" value={bkDdHigh} onChange={setBkDdHigh} />
                        </Stack>
                      )}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                        <Num label={t("app.water.lvl.aboveWell")} unit="m" value={bkDeliv} onChange={setBkDeliv} width={250} helper={t("app.water.lvl.aboveWellHelp")} />
                        <Num label={t("app.water.bk.pipeLow")} unit="m" value={bkPipeLow} onChange={setBkPipeLow} width={230} />
                        <Num label={t("app.water.high")} unit="m" value={bkPipeHigh} onChange={setBkPipeHigh} helper={t("app.step.state.optional")} />
                      </Stack>
                      <Num label={t("app.water.bk.yield")} unit="m³/day" value={bkCap} onChange={setBkCap} width={230} helper={t("app.water.bk.yieldHelp")} />
                    </Stack>
                  )}
                </Box>
              </Box>
            ) : (
              <Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
                  <TextField select size="small" label={t("app.water.gw.searchWithin")} value={gwRadius} onChange={(e) => setGwRadius(Number(e.target.value))} sx={{ width: 170 }}>
                    {RADII_GW.map((r) => (
                      <MenuItem key={r} value={r}>
                        {fmt(t("app.water.s1.ofField"), { r: km(r) })}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button variant="outlined" onClick={() => { setSelectedWell(null); void loadGw(gwRadius); }} disabled={gw.state === "loading"}>
                    {gw.state === "loading" ? t("loc.searching") : t("app.water.gw.search")}
                  </Button>
                </Stack>
                <GroundwaterStatus gw={gw} />
                {stations.length > 0 && (
                  <RadioGroup value={selectedWell ?? ""} onChange={(e) => setSelectedWell(e.target.value)} aria-label={t("app.water.gw.list")}>
                    <Box sx={{ maxHeight: 300, overflowY: "auto", border: `1px solid ${color.line}`, borderRadius: `${radius.md}px`, px: 1.5 }}>
                      {stations.slice(0, 30).map((s) => {
                        const latest = s.measurements[0];
                        const d = latest ? depthBelowGround(latest, s) : null;
                        return (
                          <FormControlLabel
                            key={`${s.provider}:${s.stationId}`}
                            value={`${s.provider}:${s.stationId}`}
                            control={<Radio size="small" />}
                            sx={{ display: "flex", alignItems: "flex-start", my: 0.5, "& .MuiFormControlLabel-label": { pt: 0.75 } }}
                            label={
                              <Box>
                                <Typography component="span" sx={{ fontWeight: 600 }}>
                                  {s.name}
                                </Typography>
                                <Typography component="div" variant="body2" color="text.secondary">
                                  {fmt(t("app.water.gw.fromEdge"), { d: km(s.distanceM) })} · {s.authority}
                                  {s.mirrors.length ? ` (${fmt(t("app.water.gw.mirrors"), { list: s.mirrors.map((m) => (m.provider === "igrac_ggmn" ? "GGMN" : m.provider)).join(", ") })})` : ""}
                                </Typography>
                                <Typography component="div" variant="body2">
                                  {latest
                                    ? `${w.date(latest.time.slice(0, 10))}: ${d ? `${fmt(t("app.water.gw.belowGround"), { m: num(d.depthM, 2) })}${d.derived ? ` ${t("app.water.gw.derived")}` : ""}` : latest.kind === "level_elevation" ? fmt(t("app.water.gw.levelDatum"), { m: num(latest.valueM, 2), datum: latest.datum ?? "" }) : fmt(t("app.water.gw.belowMp"), { m: num(latest.valueM, 2) })}${latest.originalUnit !== "m" ? ` · ${fmt(t("app.water.gw.original"), { v: latest.originalValue, unit: latest.originalUnit })}` : ""}${latest.levelState !== "unknown" ? ` · ${t(`app.water.gw.state.${latest.levelState}` as MessageKey)}` : ""}`
                                    : s.recency === "not_requested" ? t("app.water.gw.notRequested") : t("app.water.gw.noObs")}
                                  {s.recency === "historical" ? ` · ${t("app.water.gw.older")}` : ""}
                                </Typography>
                                <Typography component="div" variant="caption" color="text.secondary">
                                  {t("app.water.gw.aquifer")} {s.aquifer ?? t("app.water.gw.notStated")}
                                  {s.wellDepthM != null ? ` · ${fmt(t("app.water.gw.wellDepth"), { m: num(s.wellDepthM, 1) })}` : ""}
                                  {s.recordUrl ? (
                                    <>
                                      {" · "}
                                      <a href={s.recordUrl} target="_blank" rel="noreferrer">
                                        {t("app.water.gw.record")}
                                      </a>
                                    </>
                                  ) : null}
                                </Typography>
                              </Box>
                            }
                          />
                        );
                      })}
                    </Box>
                  </RadioGroup>
                )}
                <Typography component="h3" variant="subtitle1" sx={{ mt: 2, fontWeight: 700 }}>
                  {t("app.water.lvl.title")}
                </Typography>
                <RadioGroup value={depthMode} onChange={(e) => setDepthMode(e.target.value as typeof depthMode)}>
                  <FormControlLabel value="measured" control={<Radio size="small" />} label={t("app.water.lvl.measuredOwn")} />
                  <FormControlLabel value="proxy" control={<Radio size="small" />} label={t("app.water.lvl.proxy")} />
                  <FormControlLabel value="hypothetical" control={<Radio size="small" />} label={t("app.water.lvl.tryHypothetical")} />
                  <FormControlLabel value="unknown" control={<Radio size="small" />} label={t("app.water.lvl.dontKnow")} />
                </RadioGroup>
                {depthMode === "unknown" && <Alert severity="info">{t("app.water.lvl.unknownNote")}</Alert>}
                {depthMode === "proxy" && (chosenWell ? proxy?.ok ? (
                  <Alert severity="info" sx={{ mb: 1 }}>
                    {fmt(t("app.water.lvl.proxyNote"), { name: chosenWell.name, d: km(chosenWell.distanceM), low: num(proxy.low, 2), high: num(proxy.high, 2), n: w.int(proxy.count), date: w.date(proxy.latest.m.time.slice(0, 10)) })}{" "}
                    {chosenWell.aquifer ? t("app.water.lvl.aquiferUnknown") : t("app.water.lvl.aquiferNotStated")}{" "}
                    {chosenWell.measurements[0]?.levelState === "pumping" ? t("app.water.lvl.pumpingRecorded") : t("app.water.lvl.staticAdd")}
                  </Alert>
                ) : <Alert severity="warning">{proxy?.why}</Alert> : <Alert severity="info">{t("app.water.lvl.selectWell")}</Alert>)}
                {(depthMode === "measured" || depthMode === "hypothetical") && (
                  <Stack spacing={1.5} sx={{ mt: 1 }}>
                    {depthMode === "measured" && (
                      <TextField select size="small" label={t("app.water.lvl.whatMeasured")} value={levelKind} onChange={(e) => setLevelKind(e.target.value as typeof levelKind)} sx={{ maxWidth: 360 }}>
                        <MenuItem value="pumping">{t("app.water.lvl.pumping")}</MenuItem>
                        <MenuItem value="static_plus_drawdown">{t("app.water.lvl.static")}</MenuItem>
                      </TextField>
                    )}
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                      <Num label={depthMode === "measured" ? t("app.water.lvl.depth") : t("app.water.lvl.shallowest")} unit="m" value={depthLow} onChange={setDepthLow} helper={t("app.water.lvl.depthHelp")} />
                      <Num label={depthMode === "measured" ? t("app.water.lvl.deepestOpt") : t("app.water.lvl.deepest")} unit="m" value={depthHigh} onChange={setDepthHigh} helper={t("app.water.lvl.deepestHelp")} />
                    </Stack>
                  </Stack>
                )}
                {depthMode !== "unknown" && ((depthMode === "measured" && levelKind === "static_plus_drawdown") || depthMode === "hypothetical" || (depthMode === "proxy" && chosenWell?.measurements[0]?.levelState !== "pumping")) && (
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 1.5 }}>
                    <Num label={t("app.water.lvl.drawdownLow")} unit="m" value={ddLow} onChange={setDdLow} helper={t("app.water.lvl.ddHelp")} width={230} />
                    <Num label={t("app.water.high")} unit="m" value={ddHigh} onChange={setDdHigh} />
                  </Stack>
                )}
                {depthMode === "hypothetical" && levelKind !== "static_plus_drawdown" && null}
                <Box sx={{ mt: 1.5 }}>
                  <Num label={t("app.water.lvl.aboveWell")} unit="m" value={deliveryAboveGround} onChange={setDeliveryAboveGround} width={260} helper={t("app.water.lvl.aboveWellHelp")} />
                </Box>
              </Box>
            )}
          </Section>

          <Section id="water-demand" step={2} title={t("app.water.s2.title")} intro={t("app.water.s2.intro")}>
            <ToggleButtonGroup exclusive value={demandMode} onChange={(_, v) => v && setDemandMode(v)} sx={{ mb: 2 }} aria-label={t("app.water.s2.demandSource")}>
              <ToggleButton value="run" disabled={!runs.length}>{t("app.water.s2.fromRun")}</ToggleButton>
              <ToggleButton value="manual">{t("app.water.s2.own")}</ToggleButton>
            </ToggleButtonGroup>
            {demandMode === "run" ? (
              runs.length ? (
                <>
                  <TextField select fullWidth size="small" label={t("app.water.s2.comparison")} value={runId ?? ""} onChange={(e) => setRunId(e.target.value)} sx={{ mb: 1.5 }}>
                    {runs.map((r) => (
                      <MenuItem key={r.runId} value={r.runId}>
                        {r.scenarioName} · {fmt(t("app.water.s2.finished"), { date: r.finishedAt ? w.date(r.finishedAt.slice(0, 10)) : "—" })} · {r.demand.irrigationMode === "full" ? t("app.water.s2.irrigated") : t("app.water.s2.rainfed")}
                        {!runUsable(r) && ` · ${t("app.water.s2.noNeed")}`}
                      </MenuItem>
                    ))}
                  </TextField>
                  {run && !runUsable(run) ? (
                    <Alert severity="warning">
                      {t("app.water.s2.cannotUse")} {run.demand.unavailable ?? run.demand.options.find((o) => o.unavailable)?.unavailable ?? ""}
                      <Box sx={{ mt: 1 }}>
                        <Button variant="outlined" color="inherit" size="small" onClick={() => setDemandMode("manual")}>
                          {t("app.water.s2.useOwn")}
                        </Button>
                      </Box>
                    </Alert>
                  ) : (
                    run && (
                      <Typography variant="body2" component="div">
                        {fmt(t("app.water.s2.options"), { n: w.int(run.demand.options.length) })} {run.demand.options.map((o) => `${o.label} (${o.annualNetMedianMm != null ? fmt(t("app.water.s2.medianNet"), { v: num(o.annualNetMedianMm, 0) }) : t("app.water.s2.needUnavailable")})`).join("; ")}. <ClassChip kind="modelled" />
                      </Typography>
                    )
                  )}
                </>
              ) : (
                <Alert severity="info">{t("app.water.s2.noRun")}</Alert>
              )
            ) : (
              <Stack spacing={1.5}>
                {runs.length > 0 && !anyUsableRun && <Alert severity="info">{t("app.water.s2.noUsable")}</Alert>}
                <Num label={t("app.water.s2.daily")} unit="m³/day" value={manualDaily} onChange={setManualDaily} width={260} />
                <Box>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {t("app.water.s2.months")}
                  </Typography>
                  <ToggleButtonGroup size="small" value={manualMonths} onChange={(_, v: number[]) => setManualMonths(v)} aria-label={t("app.water.s2.months")} sx={{ flexWrap: "wrap" }}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <ToggleButton key={i} value={i + 1} sx={{ minWidth: 44 }}>
                        {w.monthShort(i + 1)}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Box>
                <TextField select size="small" label={t("app.water.s2.volumeIs")} value={manualBasis} onChange={(e) => setManualBasis(e.target.value as typeof manualBasis)} sx={{ maxWidth: 320 }}>
                  <MenuItem value="farmer_report">{t("app.water.s2.actual")}</MenuItem>
                  <MenuItem value="hypothetical_input">{t("app.water.s2.whatIf")}</MenuItem>
                </TextField>
              </Stack>
            )}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2 }}>
              <TextField
                select
                size="small"
                label={t("app.water.s2.method")}
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                sx={{ width: { xs: "100%", sm: 260 } }}
                helperText={method === "own" ? t("app.water.s2.ownValue") : fmt(t("app.water.s2.uses"), { lo: w.int(ATTAINABLE_APPLICATION_EFFICIENCY[method][0] * 100), hi: w.int(ATTAINABLE_APPLICATION_EFFICIENCY[method][1] * 100) })}
              >
                {(Object.keys(METHOD_LABELS) as IrrigationMethod[]).map((m) => (
                  <MenuItem key={m} value={m}>
                    {t(`app.water.method.${m}`)}
                  </MenuItem>
                ))}
                <MenuItem value="own">{t("app.water.s2.knowEff")}</MenuItem>
              </TextField>
              {method === "own" && <Num label={t("app.water.s2.appEff")} unit="%" value={ownEff} onChange={setOwnEff} />}
            </Stack>
            <More label={t("app.water.s2.more")}>
              <Num label={t("app.water.s2.convEff")} unit="%" value={conveyance} onChange={setConveyance} helper={t("app.water.s2.convHelp")} />
            </More>
          </Section>

          <Section id="water-pump" step={3} title={t("app.water.s3.title")} intro={t("app.water.s3.intro")}>
            {startingEmpty ? (
              <Button variant="outlined" onClick={applyStarting} sx={{ mb: 2 }}>
                {t("app.water.s3.starting")}
              </Button>
            ) : (
              <Alert severity="info" sx={{ mb: 2 }}>
                {fmt(t("app.water.s3.startingNote"), { dia: STARTING.diameter, eta: STARTING.eta, h: STARTING.runtime })}
              </Alert>
            )}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Num label={t("app.water.s3.pipeLow")} unit="m" value={pipeLow} onChange={(v) => { setPipeLow(v); setPipeBasis("farmer_report"); }} helper={pipeBasis === "mapped_feature" ? t("app.water.s3.pipeMinHelp") : t("app.water.p.yourRoute")} width={220} />
              <Num label={t("app.water.high")} unit="m" value={pipeHigh} onChange={(v) => { setPipeHigh(v); setPipeBasis("farmer_report"); }} width={140} />
              <Num label={t("app.water.s3.hours")} unit="h" value={runtime} onChange={setRuntime} />
            </Stack>
            <More label={t("app.water.s3.advanced")}>
              <Num label={t("app.water.s3.eta")} unit="%" value={eta} onChange={setEta} helper={t("app.water.s3.etaHelp")} width={230} />
              <Num label={t("app.water.s3.diameter")} unit="mm" value={diameter} onChange={setDiameter} />
              <TextField select size="small" label={t("app.water.s3.material")} value={material} onChange={(e) => setMaterial(e.target.value)} sx={{ width: { xs: "100%", sm: 280 } }} helperText={t("app.water.s3.roughness")}>
                {PIPE_MATERIALS.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {t(`app.water.pipe.${m.id}`)} (ε {w.num(m.eps, 4)} mm)
                  </MenuItem>
                ))}
              </TextField>
              <Num label={t("app.water.s3.kLow")} value={kLow} onChange={setKLow} helper={t("app.water.s3.kHelp")} />
              <Num label={t("app.water.s3.kHigh")} value={kHigh} onChange={setKHigh} />
              <Num label={t("app.water.s3.pressure")} unit="kPa" value={pressure} onChange={setPressure} helper={t("app.water.s3.pressureHelp")} width={230} />
              <Num label={t("app.water.s3.pr")} unit="%" value={pr} onChange={setPr} helper={t("app.water.s3.prHelp")} width={220} />
              <Num label={t("app.water.s3.ctrl")} unit="%" value={ctrl} onChange={setCtrl} helper={t("app.water.s3.ctrlHelp")} width={200} />
            </More>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2, alignItems: { sm: "center" } }}>
              <ToggleButtonGroup exclusive size="small" value={solarMode} onChange={(_, v) => v && setSolarMode(v)} aria-label={t("app.water.s3.solarQ")}>
                <ToggleButton value="size">{t("app.water.s3.howMuch")}</ToggleButton>
                <ToggleButton value="evaluate">{t("app.water.s3.enough")}</ToggleButton>
              </ToggleButtonGroup>
              {solarMode === "evaluate" && <Num label={t("app.water.s3.myPv")} unit="kWp" value={existingKwp} onChange={setExistingKwp} />}
            </Stack>
            <SolarStatus solar={solar} onRetry={() => void loadSolar(true)} />
          </Section>

          <Section step={4} title={t("app.water.s4.title")} intro={t("app.water.s4.intro")}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Num label={t("app.water.s4.capacity")} unit="m³/day" value={capacity} onChange={setCapacity} width={220} />
              <Num label={t("app.water.s4.budget")} unit="m³/year" value={budget} onChange={setBudget} width={230} />
              <Num label={t("app.water.s4.tank")} unit="m³" value={tank} onChange={setTank} width={250} />
            </Stack>
          </Section>
        </Box>
      </Box>

      <Section id="water-result" title={t("app.water.res.title")} intro={<>{t("app.water.res.intro")} <ClassChip kind="modelled" /></>} aside={stale ? <Chip size="small" label={t("app.water.res.loading")} /> : undefined}>
        {computed.error && <Alert severity="error">{computed.error}</Alert>}
        {!computed.result && !computed.error && (
          <Alert severity="info">
            {t("app.water.res.toCalc")} {built.missing.join("; ")}.
          </Alert>
        )}
        {!computed.result && (
          // Always visible, so the farmer knows saving exists and why it is not possible yet.
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2, alignItems: { sm: "center" } }}>
            <Button variant="contained" disabled>
              {t("app.water.res.save")}
            </Button>
            <Typography variant="body2" color="text.secondary">
              {t("app.water.res.saveWhen")}
            </Typography>
          </Stack>
        )}
        {computed.result && built.input && (
          <>
            <ResultsView result={computed.result} input={built.input} />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mt: 2, alignItems: { sm: "center" } }}>
              <TextField size="small" label={t("app.water.res.name")} value={name} onChange={(e) => setName(e.target.value)} sx={{ minWidth: 260 }} />
              <Button variant="contained" onClick={save} disabled={saving}>
                {saving ? t("app.form.saving") : t("app.water.res.save")}
              </Button>
              {saving && stale && (
                // Server actions run one at a time, so a save waits for the map and sun look-ups above.
                <Typography role="status" variant="body2" color="text.secondary">
                  {t("app.water.res.saveWaits")}
                </Typography>
              )}
              {saveMsg && (
                <Typography role="status" color={saveMsg.ok ? "success.main" : "error"} variant="body2">
                  {saveMsg.text}
                </Typography>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              {t("app.water.res.saveNote")}
            </Typography>
          </>
        )}
      </Section>
    </Box>
  );
}

function GroundwaterStatus({ gw }: { gw: Load<Extract<GroundwaterLookup, { ok: true }>> }) {
  const t = useT();
  const w = useWaterFmt();
  if (gw.state === "loading") return <Typography variant="body2" sx={{ mb: 1.5 }}>{t("app.water.gw.loading")}</Typography>;
  if (gw.state === "error") return <Alert severity="warning" sx={{ mb: 1.5 }}>{gw.error}</Alert>;
  if (gw.state !== "done" || !gw.data) return null;
  const d = gw.data;
  const withObs = d.stations.filter((s) => s.measurements.length);
  return (
    <Box sx={{ mb: 1.5 }}>
      {withObs.length === 0 && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {fmt(t("app.water.gw.none"), { r: w.km(d.radiusM) })}
        </Alert>
      )}
      <Box component="ul" aria-label={t("app.water.gw.providers")} sx={{ listStyle: "none", p: 0, m: 0 }}>
        {d.providers.map((p) => (
          <Box component="li" key={p.id} sx={{ py: 0.5, borderBottom: `1px solid ${tokens.neutral[200]}` }}>
            <Typography variant="body2" component="div">
              <b>{p.name}</b>{" "}
              <Chip size="small" label={t(`app.water.outcome.${p.outcome}`) || OUTCOME_TEXT[p.outcome]} sx={{ height: 20, ml: 0.5, bgcolor: p.outcome === "records_available" ? tokens.lime[200] : p.outcome === "error" ? "#F6DED6" : tokens.neutral[150] }} />
            </Typography>
            {(p.consulted || p.outcome === "access_restricted" || p.outcome === "not_integrated") && (
              <Typography variant="caption" color="text.secondary" component="div">
                {p.message}
                {p.truncated ? ` ${t("app.water.gw.truncated")}` : ""}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
        {fmt(t("app.water.gw.searched"), { r: w.km(d.radiusM), from: w.date(d.fromDate.slice(0, 10)), at: `${w.date(d.asOf.slice(0, 10))} ${w.digits(d.asOf.slice(11, 16))}`, country: d.countryHint?.toUpperCase() ?? t("app.water.gw.noCountry") })}
      </Typography>
    </Box>
  );
}

function SolarStatus({ solar, onRetry }: { solar: Load<Extract<SolarOutcome, { ok: true }>>; onRetry: () => void }) {
  const t = useT();
  const w = useWaterFmt();
  if (solar.state === "loading") return <Typography variant="body2" sx={{ mt: 2 }}>{t("app.water.sun.loading")}</Typography>;
  if (solar.state === "error")
    return (
      <Alert severity="warning" sx={{ mt: 2 }} action={<Button onClick={onRetry}>{t("app.ev.retry")}</Button>}>
        {solar.error} {t("app.water.sun.errorNote")}
      </Alert>
    );
  if (!solar.data) return null;
  const s = solar.data.summary;
  return (
    <Box component="details" sx={{ mt: 2 }}>
      <Box component="summary" sx={{ cursor: "pointer", fontWeight: 600, color: tokens.forest[600] }}>
        {fmt(t("app.water.sun.title"), { from: w.digits(s.fromDate.slice(0, 4)), to: w.digits(s.toDate.slice(0, 4)) })} <ClassChip kind="modelled" />
      </Box>
      <Stack direction="row" useFlexGap spacing={0.75} sx={{ flexWrap: "wrap", mt: 1 }}>
        {s.months.map((m) => (
          <Box key={m.month} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: color.surface, minWidth: 70 }}>
            <Typography variant="caption" color="text.secondary">
              {w.monthShort(m.month)}
            </Typography>
            <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{w.num(m.meanPsh, 2)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {fmt(t("app.water.sun.lowDay"), { v: w.num(m.p10Psh, 1) })}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {fmt(t("app.water.sun.caption"), {
          units: solar.data.provenance.units,
          sources: solar.data.provenance.upstream.join(", ") || t("app.water.gw.notStated"),
          api: solar.data.provenance.apiVersion ?? "?",
          at: `${w.date(solar.data.provenance.retrievedAt.slice(0, 10))} ${w.digits(solar.data.provenance.retrievedAt.slice(11, 16))}`,
          n: w.int(s.missingDays),
        })}

      </Typography>
    </Box>
  );
}
