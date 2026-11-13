import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/farm/DeleteButton";
import { Empty, EvidenceChip, More, PageHeader, RecordList, Section, StatusChip } from "@/components/farm/ui";
import { FormField, FormSelect } from "@/components/forms/ActionForm";
import { SetupRequired } from "@/components/SetupRequired";
import { AutoRefresh } from "@/components/simulation/AutoRefresh";
import { RunPanel } from "@/components/simulation/RunPanel";
import { ScenarioForm, type RunBlock } from "@/components/simulation/ScenarioForm";
import { canonicalJson } from "@/domain/reference/canonical";
import { IRRIGATION_ASSUMPTIONS, parseScenarioSettings, RUNOFF_SOIL_GROUPS } from "@/domain/scenario/settings";
import { suggestRegions, type PastChoice } from "@/domain/farm/calendar-suggest";
import { CROP_CATALOG, resolveCrop } from "@/domain/simulation/catalog";
import { ENGINE_VERSION } from "@/domain/simulation/engine-version";
import { getT } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/sim-messages";
import { requireUser } from "@/server/auth/session";
import { calendarChoices } from "@/server/farm/calendars";
import { deleteOwnedRecord } from "@/server/farm/actions";
import { fieldFacts, getScenario } from "@/server/farm/queries";
import { reversePlace } from "@/server/geocode/nominatim";
import { cancelRun, reproduceRun, saveAndRun } from "@/server/simulation/actions";
import { listScenarioRuns } from "@/server/simulation/queries";
import { color, radius } from "@/theme/tokens";

export const metadata: Metadata = { title: "Crop comparison" };

type PinnedDataset = { id: string; kind: string; name: string; version: number; content_sha256: string };
type HistoryRow = { zone_id: string | null; crop_name: string; planted_on: string | null; harvested_on: string | null };

/** A download started less than this long ago still holds the start button; after that the farmer is not kept waiting on a retrying soil service. */
const SOIL_WAIT_MS = 90_000;
const PLACE_WAIT_MS = 2500;
const isRecent = (iso: string) => Date.now() - Date.parse(iso) < SOIL_WAIT_MS;

/** Crops the engine can date from the farmer's own whole-field seasons (20 to 330 days, as in buildSlots). */
function datedCropIds(history: HistoryRow[]): string[] {
  const ids = new Set<string>();
  for (const h of history) {
    if (h.zone_id !== null || !h.planted_on || !h.harvested_on) continue;
    const days = (Date.parse(h.harvested_on) - Date.parse(h.planted_on)) / 86_400_000;
    const crop = resolveCrop(h.crop_name, CROP_CATALOG);
    if (crop && days >= 20 && days <= 330) ids.add(crop.id);
  }
  return [...ids];
}

export default async function ScenarioPage({ params }: PageProps<"/scenarios/[scenarioId]">) {
  const { scenarioId } = await params;
  const t = await getT();
  const user = await requireUser(`/scenarios/${scenarioId}`);
  if (user.state !== "signed_in") return <SetupRequired feature="Saving scenarios" reason={user.state} />;
  if (!/^[0-9a-f-]{36}$/i.test(scenarioId)) notFound();
  const sc = await getScenario(user.supabase, scenarioId);
  if (!sc) notFound();

  // Stored settings are re-validated on read; an invalid stored value is shown, never silently replaced.
  const parsed = parseScenarioSettings(sc.settings_schema_version, sc.settings, new Date().getUTCFullYear());
  const s = parsed.ok ? parsed.settings : null;
  const latest = sc.snapshots[0];
  const latestMatches = latest ? canonicalJson(latest.inputs) === canonicalJson(sc.currentInputs) : false;
  const runs = await listScenarioRuns(user.supabase, sc.id);

  const currentInputs = sc.currentInputs as { field?: { centroid?: { coordinates?: [number, number] } | null }; crop_history?: HistoryRow[] } | null;
  const centroid = currentInputs?.field?.centroid?.coordinates ?? null;
  const [{ data: farm }, facts, { data: soilJobs }, place, { data: others }] = await Promise.all([
    user.supabase.from("farms").select("country_code").eq("id", sc.farmId).maybeSingle(),
    fieldFacts(user.supabase, [sc.field_id]),
    user.supabase.from("evidence_jobs").select("created_at").eq("field_id", sc.field_id).in("source_id", ["usda-ssurgo-sda", "isric-soilgrids-v2"]).in("status", ["queued", "running"]),
    // A slow geocoder never holds the form: after PLACE_WAIT_MS the list is shown without place suggestions.
    centroid ? Promise.race([reversePlace(centroid[1], centroid[0]), new Promise<null>((r) => setTimeout(() => r(null), PLACE_WAIT_MS))]) : Promise.resolve(null),
    user.supabase.from("scenarios").select("id, field_id, settings, fields(farm_id)").neq("id", sc.id).order("updated_at", { ascending: false }).limit(100),
  ]);
  const country = farm?.country_code ?? place?.countryCode ?? null;
  const calendar = await calendarChoices(user.supabase, country, s?.calendarRegion ?? null);
  // Areas that fit this field go first in the list; one is chosen only for a comparison never saved
  // since it was created, and only when there is a single clear answer (see suggestRegions).
  const past: PastChoice[] = (others ?? []).flatMap((o) => {
    const region = (o.settings as { calendarRegion?: unknown } | null)?.calendarRegion;
    if (typeof region !== "string" || !region) return [];
    const farmId = (o.fields as unknown as { farm_id: string } | null)?.farm_id;
    return [{ region, scope: o.field_id === sc.field_id ? "this_field" : farmId === sc.farmId ? "this_farm" : "other" }];
  });
  const suggested = suggestRegions(calendar.regions, place?.names ?? [], past);
  const fresh = !s?.calendarRegion && sc.created_at === sc.updated_at;
  const auto = fresh ? suggested.auto : null;
  const autoNote = auto ? fmt(t(`cmp.s2.auto.${auto.reason}` as "cmp.s2.auto.place"), { place: auto.place ?? "" }) : null;
  const suggestions = suggested.suggestions.map((x) => ({ value: x.value, note: fmt(t(`cmp.s2.why.${x.reason}`), { place: x.place ?? "" }) }));
  const fact = facts.get(sc.field_id);
  const active = runs.some((r) => r.status === "queued" || r.status === "running");
  const soilPending = (soilJobs ?? []).some((j) => isRecent(j.created_at));
  const block: RunBlock = !centroid ? "location" : active ? "active" : (fact?.weatherPending && !fact.hasWeather) || soilPending ? "pending" : !fact?.hasWeather ? "no_weather" : null;
  const irrigationLabel = (v: (typeof IRRIGATION_ASSUMPTIONS)[number]) => t(`cmp.irr.${v}`);

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <PageHeader
        crumbs={[{ href: "/workspace", label: t("app.ws.title") }, { href: `/fields/${sc.field_id}/records`, label: sc.fieldName }]}
        title={sc.name}
        eyebrow={fmt(t("cmp.eyebrow"), { field: sc.fieldName })}
        subtitle={t("cmp.subtitle")}
      >
        <EvidenceChip evidenceClass="hypothetical_input" />{" "}
        <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {fmt(t("cmp.updated"), { date: new Date(sc.updated_at).toISOString().slice(0, 10) })}
        </Typography>
      </PageHeader>
      {block === "pending" && <AutoRefresh />}

      <Section id="settings" icon={<TuneRoundedIcon />} title={t("cmp.form.title")} intro={t("cmp.form.intro")}>
        {!s && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            The saved settings no longer pass the checks. Review them and save again.
          </Alert>
        )}
        {parsed.ok && parsed.upgradedFrom === 1 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This comparison was created before planting windows and weather changes existed. Save it once to store the new settings.
          </Alert>
        )}
        <ScenarioForm
          action={saveAndRun.bind(null, sc.id)}
          initialCrops={s?.candidateCrops ?? []}
          initialRegion={s?.calendarRegion ?? auto?.value ?? ""}
          suggestions={suggestions}
          autoNote={autoNote}
          windows={s?.plantingWindows ?? []}
          regions={calendar.regions}
          dates={calendar.dates}
          datesKnown={calendar.datesKnown}
          historyCropIds={datedCropIds(currentInputs?.crop_history ?? [])}
          evidenceHref={`/fields/${sc.field_id}/evidence`}
          block={block}
          irrigation={
            <>
              <FormSelect name="irrigationAssumption" label={t("cmp.irrigation")} options={IRRIGATION_ASSUMPTIONS.map((v) => ({ value: v, label: irrigationLabel(v) }))} defaultValue={s?.irrigationAssumption} helperText={t("cmp.irrHelp")} sx={{ minWidth: 280 }} />
              <FormSelect
                name="runoffSoilGroup"
                label={t("cmp.runoff")}
                options={[{ value: "", label: t("cmp.runoff.none") }, ...RUNOFF_SOIL_GROUPS.map((g) => ({ value: g, label: t(`cmp.runoff.${g}`) }))]}
                defaultValue={s?.runoffSoilGroup ?? ""}
                sx={{ minWidth: 280 }}
              />
            </>
          }
        >
          <Box sx={{ width: "100%", p: 2, borderRadius: `${radius.md}px`, bgcolor: color.surface, border: `1px solid ${color.line}` }}>
            <Typography variant="subtitle2" component="h3">
              {t("cmp.whatif.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t("cmp.whatif.help")}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <FormField name="precipitationChangePct" label={t("cmp.whatif.rain")} type="number" defaultValue={s?.precipitationChangePct ?? 0} helperText={t("cmp.whatif.rainHelp")} sx={{ width: { sm: 280 } }} />
              <FormField name="temperatureChangeC" label={t("cmp.whatif.temp")} type="number" defaultValue={s?.temperatureChangeC ?? 0} helperText={t("cmp.whatif.tempHelp")} slotProps={{ htmlInput: { step: 0.5 } }} sx={{ width: { sm: 280 } }} />
            </Stack>
          </Box>

          <More label={t("cmp.more")}>
            <FormField name="name" label={t("cmp.name")} required defaultValue={sc.name} sx={{ minWidth: 260 }} />
            <FormField name="rotationYears" label={t("cmp.rotation")} type="number" defaultValue={s?.rotationYears ?? 2} helperText={t("cmp.rotationHelp")} sx={{ width: 190 }} />
            <FormField name="replayFromYear" label={t("cmp.weatherFrom")} type="number" defaultValue={s?.replayFromYear ?? ""} sx={{ width: 160 }} />
            <FormField name="replayToYear" label={t("cmp.weatherTo")} type="number" defaultValue={s?.replayToYear ?? ""} sx={{ width: 160 }} />
            <FormField name="turnaroundDays" label={t("cmp.turnaround")} type="number" defaultValue={s?.turnaroundDays ?? ""} helperText={t("cmp.turnaroundHelp")} sx={{ width: 300 }} />
            <FormField name="notes" label={t("cmp.notes")} defaultValue={s?.notes ?? ""} sx={{ minWidth: 260, flexGrow: 1 }} />
          </More>
        </ScenarioForm>
      </Section>

      <Section id="results" icon={<PlayArrowRoundedIcon />} title={t("cmp.results.title")} intro={t("cmp.results.intro")}>
        <RunPanel
          runs={runs}
          // eslint-disable-next-line react-hooks/purity -- server render time, used only to flag long-queued runs
          renderedAt={Date.now()}
          emptyText={t("cmp.results.none")}
          actions={{ reproduce: reproduceRun, cancel: cancelRun }}
        />
      </Section>

      <Section
        id="record"
        collapsible
        icon={<Inventory2OutlinedIcon />}
        title="Saved inputs (for advisers)"
        intro="Every run keeps a frozen copy of all inputs, so a saved result can always be reproduced exactly."
        aside={latest ? <StatusChip done={latestMatches} label={latestMatches ? "Matches current inputs" : "Inputs changed since the last run"} /> : undefined}
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 760 }}>
          A snapshot holds the field shape, parts, seasons, soil, water, priorities, markets, these settings and the pinned weather and soil data, with the exact reference-data versions by id and hash.
          Snapshots cannot be edited, so a saved run never silently picks up changed rules or newer data.
        </Typography>
        {latest && !latestMatches && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Inputs have changed since the newest snapshot. Earlier snapshots keep their original inputs; the next run takes a new one.
          </Alert>
        )}
        {sc.snapshots.length === 0 ? (
          <Empty>No snapshots yet. Running the comparison creates one.</Empty>
        ) : (
          <RecordList
            label="Input snapshots"
            items={sc.snapshots.map((snap) => {
              const pinned = ((snap.inputs as { reference_datasets?: PinnedDataset[] }).reference_datasets ?? []) as PinnedDataset[];
              return {
                key: snap.id,
                primary: `${new Date(snap.created_at).toISOString().replace("T", " ").slice(0, 19)} UTC · sha256 ${snap.inputs_sha256.slice(0, 16)}…`,
                secondary: (
                  <>
                    Engine {snap.engine_version}
                    {snap.engine_version !== ENGINE_VERSION ? " (taken before the engine existed; cannot be run)" : ""} · input schema v{snap.input_schema_version} · reference data:{" "}
                    {pinned.length ? pinned.map((d) => `${d.name} v${d.version} (${d.content_sha256.slice(0, 8)})`).join(", ") : "none published"}
                    <Box component="details" sx={{ mt: 1 }}>
                      <summary>Show frozen inputs</summary>
                      <Box component="pre" sx={{ fontSize: "0.75rem", maxHeight: 360, overflow: "auto", bgcolor: "background.paper", p: 1.5, borderRadius: 1 }}>
                        {JSON.stringify(snap.inputs, null, 2)}
                      </Box>
                    </Box>
                  </>
                ),
              };
            })}
          />
        )}
      </Section>

      <Section id="delete" collapsible tone="danger" icon={<DeleteOutlineRoundedIcon />} title="Delete this comparison" intro="Removes the comparison with its snapshots, runs and results.">
        <DeleteButton action={deleteOwnedRecord.bind(null, "scenarios", sc.id, sc.field_id)} label={`Delete scenario ${sc.name}`} confirmLabel="Yes, delete this comparison" />
      </Section>
    </Container>
  );
}
