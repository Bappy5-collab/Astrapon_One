"use client";

import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";

import { ActionForm, useFormError } from "@/components/forms/ActionForm";
import { ButtonLink } from "@/components/links";
import type { FormState } from "@/lib/forms/state";
import { CROP_CATALOG, resolveCrop } from "@/domain/simulation/catalog";
import { useLocale, useT } from "@/lib/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/sim-messages";
import { MAX_PLANTING_WINDOWS } from "@/domain/scenario/settings";
import { color, radius, tokens } from "@/theme/tokens";

export type CalendarDate = { region: string; cropId: string; from: string; to: string };
export type PlantingWindow = { crop: string; plantFrom: string; plantTo: string; lengthDays: number };
export type RunBlock = "location" | "no_weather" | "pending" | "active" | null;

const CROP_BN: Record<string, string> = {
  rice: "ধান", spring_wheat: "গম", winter_wheat: "শীতকালীন গম", maize: "ভুট্টা", lentil: "মসুর", chickpea: "ছোলা", mustard: "সরিষা", jute: "পাট", potato: "আলু", sesame: "তিল",
  groundnut: "চিনাবাদাম", green_gram_cowpea: "মুগ / বরবটি", pea_dry: "মটর", barley: "যব", sunflower: "সূর্যমুখী", cotton: "তুলা", millet: "কাউন", soybean: "সয়াবিন", rapeseed: "রেপসিড / ক্যানোলা", flax: "তিসি",
};

const cropKey = (name: string) => resolveCrop(name, CROP_CATALOG)?.id ?? name.trim().toLowerCase();
const OPTIONS = CROP_CATALOG.map((c) => c.id);
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

function useCropLabel() {
  const locale = useLocale();
  return (v: string) => {
    const c = resolveCrop(v, CROP_CATALOG);
    if (!c) return v;
    return locale === "bn" && CROP_BN[c.id] ? `${CROP_BN[c.id]} (${c.label})` : c.label;
  };
}

function useDateLabel() {
  const locale = useLocale();
  return (md: string) => new Date(`2023-${md}T00:00:00Z`).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Searchable crop chips; submits the same comma-separated `candidateCrops` value as a text box. */
export function CropPicker({ value, onChange, name = "candidateCrops" }: { value: string[]; onChange: (v: string[]) => void; name?: string }) {
  const t = useT();
  const label = useCropLabel();
  const error = useFormError(name);
  const taken = new Set(value.map(cropKey));
  return (
    <Box sx={{ width: "100%" }}>
      <input type="hidden" name={name} value={value.join(", ")} />
      <Autocomplete
        multiple
        freeSolo
        autoSelect
        options={OPTIONS}
        value={value}
        onChange={(_, v) => {
          const seen = new Set<string>();
          onChange(v.map((s) => s.trim()).filter((s) => s && !seen.has(cropKey(s)) && seen.add(cropKey(s))).slice(0, 8));
        }}
        filterSelectedOptions
        getOptionLabel={label}
        getOptionDisabled={(o) => taken.has(o) || value.length >= 8}
        filterOptions={(opts, state) => {
          const q = state.inputValue.trim().toLowerCase();
          return opts.filter((o) => !q || label(o).toLowerCase().includes(q) || CROP_CATALOG.find((c) => c.id === o)!.aliases.some((a) => a.toLowerCase().includes(q)));
        }}
        renderInput={(p) => <TextField {...p} size="small" label={t("cmp.s1.label")} placeholder={value.length ? undefined : t("cmp.s1.placeholder")} error={Boolean(error)} helperText={error} />}
      />
    </Box>
  );
}

/** A self-contained controller for forms outside the comparison page. */
export function CropPickerField({ initial = [] }: { initial?: string[] }) {
  const [crops, setCrops] = useState(initial);
  return <CropPicker value={crops} onChange={setCrops} />;
}

function MonthDay({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const error = useFormError(name);
  const [m = "", d = ""] = value.split("-");
  const monthName = (mm: string) => new Date(`2023-${mm}-15T00:00:00Z`).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB", { month: "long", timeZone: "UTC" });
  const set = (mm: string, dd: string) => onChange(mm || dd ? `${mm}-${dd}` : "");
  return (
    <Box>
      <input type="hidden" name={name} value={m && d ? value : ""} />
      <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={1}>
        <TextField select size="small" value={m} onChange={(e) => set(e.target.value, d)} slotProps={{ select: { displayEmpty: true, SelectDisplayProps: { "aria-label": `${label}: ${t("cmp.dates.month")}` } as object } }} error={Boolean(error)} sx={{ minWidth: 132 }}>
          <MenuItem value="" sx={{ color: "text.secondary" }}>{t("cmp.dates.month")}</MenuItem>
          {MONTHS.map((x) => <MenuItem key={x} value={x}>{monthName(x)}</MenuItem>)}
        </TextField>
        <TextField select size="small" value={d} onChange={(e) => set(m, e.target.value)} slotProps={{ select: { displayEmpty: true, SelectDisplayProps: { "aria-label": `${label}: ${t("cmp.dates.day")}` } as object } }} error={Boolean(error)} sx={{ minWidth: 84 }}>
          <MenuItem value="" sx={{ color: "text.secondary" }}>{t("cmp.dates.day")}</MenuItem>
          {DAYS.map((x) => <MenuItem key={x} value={x}>{Number(x).toLocaleString(locale === "bn" ? "bn-BD" : "en-US")}</MenuItem>)}
        </TextField>
      </Stack>
      {error && <Typography variant="caption" color="error">{error}</Typography>}
    </Box>
  );
}

function StepCard({ n, title, help, tour, children }: { n: number; title: string; help: string; tour: string; children: React.ReactNode }) {
  const locale = useLocale();
  return (
    <Box data-tour={tour} sx={{ width: "100%", p: { xs: 2, md: 2.5 }, borderRadius: `${radius.md}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box aria-hidden sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: tokens.forest[700], color: tokens.neutral[0], fontWeight: 700, fontSize: "0.9rem" }}>
          {n.toLocaleString(locale === "bn" ? "bn-BD" : "en-US")}
        </Box>
        <Typography variant="h6" component="h3" sx={{ fontSize: "1.1rem" }}>
          {title}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
        {help}
      </Typography>
      {children}
    </Box>
  );
}

type Draft = { from: string; to: string; len: string; open: boolean };
const EMPTY: Draft = { from: "", to: "", len: "", open: false };

/** The one comparison form: crops, then planting dates, then water, and the start button last. */
export function ScenarioForm({
  action,
  initialCrops,
  initialRegion,
  windows,
  regions,
  suggestions = [],
  autoNote = null,
  datesKnown,
  dates,
  historyCropIds,
  evidenceHref,
  block,
  irrigation,
  children,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  initialCrops: string[];
  initialRegion: string;
  windows: PlantingWindow[];
  regions: { value: string; label: string }[];
  /** Areas that fit this field, shown first with the reason; from suggestRegions. */
  suggestions?: { value: string; note: string }[];
  /** Set when the area was chosen for the farmer; says why, until they change it. */
  autoNote?: string | null;
  /** False when the farm's country is unknown: dates cannot be previewed, so nothing is blocked on them. */
  datesKnown: boolean;
  dates: CalendarDate[];
  historyCropIds: string[];
  evidenceHref: string;
  block: RunBlock;
  irrigation: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  const label = useCropLabel();
  const dateLabel = useDateLabel();
  const [crops, setCrops] = useState(initialCrops);
  const [region, setRegion] = useState(initialRegion);
  const [autoShown, setAutoShown] = useState(Boolean(autoNote));
  const suggestedValues = new Set(suggestions.map((x) => x.value));
  const regionText = (v: string) => regions.find((r) => r.value === v)?.label ?? v;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(windows.map((w) => [cropKey(w.crop), { from: w.plantFrom, to: w.plantTo, len: String(w.lengthDays), open: true }])));
  const regionListed = useMemo(() => regions.some((r) => r.value === region), [regions, region]);
  const patch = (k: string, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [k]: { ...(d[k] ?? EMPTY), ...p } }));

  const history = new Set(historyCropIds);
  const rows = crops.map((crop) => {
    const key = cropKey(crop);
    const known = Boolean(resolveCrop(crop, CROP_CATALOG));
    const d = drafts[key] ?? EMPTY;
    const cal = known && region ? dates.find((e) => e.region === region && e.cropId === key) : undefined;
    const fromHistory = known && history.has(key);
    const auto = fromHistory || Boolean(cal) || (Boolean(region) && !datesKnown);
    const own = d.open || !auto;
    const complete = Boolean(/^\d\d-\d\d$/.test(d.from) && /^\d\d-\d\d$/.test(d.to) && Number(d.len) > 0);
    const started = Boolean(d.from || d.to || d.len);
    return { crop, key, known, cal, fromHistory, auto, own: own && known, complete, started, d };
  });
  // Saved windows for crops not picked here (e.g. a crop from the farmer's seasons) stay in the form.
  const extra = windows.filter((w) => !crops.some((c) => cropKey(c) === cropKey(w.crop)));
  const editable = rows.filter((r) => r.own);
  const missing = rows.filter((r) => r.known && (r.own ? !r.complete && (!r.auto || r.started) : false));
  const tooMany = editable.length + extra.length > MAX_PLANTING_WINDOWS;
  const problems = [
    !crops.length ? t("cmp.block.noCrops") : null,
    missing.length ? fmt(t("cmp.block.missing"), { crops: missing.map((r) => label(r.crop)).join(", ") }) : null,
    tooMany ? fmt(t("cmp.dates.tooMany"), { n: MAX_PLANTING_WINDOWS }) : null,
    block === "location" ? t("cmp.block.location") : null,
    block === "pending" ? t("cmp.block.pending") : null,
    block === "active" ? t("cmp.block.active") : null,
  ].filter((x): x is string => Boolean(x));
  const canRun = !problems.length && block !== "no_weather";

  return (
    <ActionForm
      action={action}
      submitLabel={t("cmp.run")}
      submit={(pending) => (
        <Stack spacing={1.5} data-tour="cmp-run">
          {(problems.length > 0 || block === "no_weather") && (
            <Alert severity={block === "pending" || block === "active" ? "info" : "warning"} action={block === "no_weather" ? <ButtonLink href={evidenceHref} size="small" color="inherit">{t("cmp.block.getWeather")}</ButtonLink> : undefined}>
              <strong>{t("cmp.block.title")}</strong>
              {[...problems, ...(block === "no_weather" ? [t("cmp.block.noWeather")] : [])].map((p) => <div key={p}>{p}</div>)}
            </Alert>
          )}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button type="submit" name="intent" value="run" variant="contained" size="large" startIcon={<PlayArrowRoundedIcon />} disabled={pending || !canRun}>
              {pending ? t("cmp.running") : t("cmp.run")}
            </Button>
            <Button type="submit" name="intent" value="save" variant="text" disabled={pending}>
              {t("cmp.saveOnly")}
            </Button>
          </Stack>
        </Stack>
      )}
    >
      <StepCard n={1} tour="cmp-crops" title={t("cmp.s1.title")} help={t("cmp.s1.help")}>
        <CropPicker value={crops} onChange={setCrops} />
      </StepCard>

      <StepCard n={2} tour="cmp-dates" title={t("cmp.s2.title")} help={t("cmp.s2.help")}>
        <TextField
          select
          fullWidth
          size="small"
          name="calendarRegion"
          label={t("cmp.s2.areaLabel")}
          value={regionListed ? region : ""}
          onChange={(e) => {
            setRegion(e.target.value);
            setAutoShown(false);
          }}
          helperText={autoShown && autoNote ? autoNote : `${datesKnown ? t("cmp.s2.areaHelp") : t("cmp.s2.areaHelpAll")}${suggestions.length ? ` ${t("cmp.s2.suggestedHint")}` : ""}`}
          slotProps={{ select: { displayEmpty: true, renderValue: (v) => (v ? regionText(String(v)) : t("cmp.s2.areaNone")) }, inputLabel: { shrink: true } }}
          sx={{ maxWidth: 560, mb: 2 }}
        >
          {suggestions.length > 0 && <ListSubheader>{t("cmp.s2.areaSuggested")}</ListSubheader>}
          {suggestions.map((x) => (
            <MenuItem key={`s-${x.value}`} value={x.value} sx={{ flexDirection: "column", alignItems: "flex-start" }}>
              <span>{regionText(x.value)}</span>
              <Typography component="span" variant="caption" color="text.secondary">
                {x.note}
              </Typography>
            </MenuItem>
          ))}
          {suggestions.length > 0 && <ListSubheader>{t("cmp.s2.areaAll")}</ListSubheader>}
          <MenuItem value="">{t("cmp.s2.areaNone")}</MenuItem>
          {regions.filter((r) => !suggestedValues.has(r.value)).map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
        </TextField>

        <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>
          {t("cmp.status.title")}
        </Typography>
        {!rows.length && <Typography variant="body2" color="text.secondary">{t("cmp.status.none")}</Typography>}
        <Stack spacing={1.25}>
          {rows.map((r) => {
            const index = editable.findIndex((x) => x.key === r.key);
            const needs = r.known && r.own && !r.complete && !r.auto;
            const status = !r.known ? t("cmp.status.unknown") : r.d.open && r.complete ? t("cmp.status.own") : r.fromHistory ? t("cmp.status.history") : r.cal ? fmt(t("cmp.status.calendar"), { from: dateLabel(r.cal.from), to: dateLabel(r.cal.to) }) : r.auto ? t("cmp.status.later") : r.complete ? t("cmp.status.own") : t("cmp.status.needs");
            return (
              <Box key={r.key} sx={{ p: 1.25, borderRadius: `${radius.sm}px`, bgcolor: color.surface, border: `1px solid ${color.line}` }}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                    {needs || !r.known ? <ErrorOutlineRoundedIcon fontSize="small" sx={{ color: "warning.dark" }} /> : <CheckCircleRoundedIcon fontSize="small" sx={{ color: tokens.forest[500] }} />}
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{label(r.crop)}</Typography>
                    <Typography variant="body2" color="text.secondary">{status}</Typography>
                  </Stack>
                  {r.known && r.auto && (
                    <Button size="small" onClick={() => patch(r.key, r.d.open ? { open: false, from: "", to: "", len: "" } : { open: true })}>
                      {r.d.open ? t("cmp.useCalendar") : t("cmp.useOwn")}
                    </Button>
                  )}
                </Stack>
                {r.own && index >= 0 && index < MAX_PLANTING_WINDOWS && (
                  <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 1.25, alignItems: { md: "flex-start" } }}>
                    <input type="hidden" name={`win_crop_${index}`} value={r.d.from || r.d.to || r.d.len ? r.crop : ""} />
                    <MonthDay label={t("cmp.dates.from")} name={`win_from_${index}`} value={r.d.from} onChange={(v) => patch(r.key, { from: v })} />
                    <MonthDay label={t("cmp.dates.to")} name={`win_to_${index}`} value={r.d.to} onChange={(v) => patch(r.key, { to: v })} />
                    <DaysField label={t("cmp.dates.days")} name={`win_len_${index}`} value={r.d.len} onChange={(v) => patch(r.key, { len: v })} />
                  </Stack>
                )}
              </Box>
            );
          })}
        </Stack>
        {extra.slice(0, Math.max(0, MAX_PLANTING_WINDOWS - editable.length)).map((w, i) => {
          const index = editable.length + i;
          return (
            <Box key={`extra-${w.crop}`} hidden>
              <input type="hidden" name={`win_crop_${index}`} value={w.crop} />
              <input type="hidden" name={`win_from_${index}`} value={w.plantFrom} />
              <input type="hidden" name={`win_to_${index}`} value={w.plantTo} />
              <input type="hidden" name={`win_len_${index}`} value={w.lengthDays} />
            </Box>
          );
        })}
      </StepCard>

      <StepCard n={3} tour="cmp-water" title={t("cmp.s3.title")} help={t("cmp.s3.help")}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
          {irrigation}
        </Stack>
      </StepCard>

      {children}
    </ActionForm>
  );
}

function DaysField({ label, name, value, onChange }: { label: string; name: string; value: string; onChange: (v: string) => void }) {
  const error = useFormError(name);
  return (
    <Box>
      <Typography variant="caption" component="div" sx={{ fontWeight: 600, mb: 0.5 }}>
        {label}
      </Typography>
      <TextField size="small" type="number" name={name} value={value} onChange={(e) => onChange(e.target.value)} error={Boolean(error)} helperText={error} slotProps={{ htmlInput: { min: 20, max: 330, "aria-label": label } }} sx={{ width: 130 }} />
    </Box>
  );
}
