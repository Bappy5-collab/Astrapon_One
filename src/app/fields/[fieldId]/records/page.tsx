import AgricultureRoundedIcon from "@mui/icons-material/AgricultureRounded";
import CompareArrowsRoundedIcon from "@mui/icons-material/CompareArrowsRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import GrassRoundedIcon from "@mui/icons-material/GrassRounded";
import PolylineRoundedIcon from "@mui/icons-material/PolylineRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import ViewInArRoundedIcon from "@mui/icons-material/ViewInArRounded";
import WaterDropRoundedIcon from "@mui/icons-material/WaterDropRounded";
import WbSunnyRoundedIcon from "@mui/icons-material/WbSunnyRounded";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EvidenceDialog } from "@/components/evidence/EvidenceDialog";
import { BoundaryPreview } from "@/components/farm/BoundaryPreview";
import { DeleteButton } from "@/components/farm/DeleteButton";
import { StepGuide } from "@/components/farm/StepGuide";
import { stepText } from "@/components/farm/step-text";
import { Empty, EvidenceChip, More, PageHeader, RecordList, Section, StatusChip } from "@/components/farm/ui";
import { ActionForm, FormCheckbox, FormField, FormSelect } from "@/components/forms/ActionForm";
import { ButtonLink, TextLink } from "@/components/links";
import { SetupRequired } from "@/components/SetupRequired";
import { CropPickerField } from "@/components/simulation/ScenarioForm";
import { fieldSteps } from "@/domain/farm/progress";
import {
  EQUIPMENT,
  IRRIGATION,
  IRRIGATION_METHODS,
  PRIORITY_KEYS,
  SEASONS,
  SOIL_PROPERTIES,
  TILLAGE,
  ZONE_BASES,
} from "@/domain/farm/records";
import { IRRIGATION_ASSUMPTIONS } from "@/domain/scenario/settings";
import { formatterFor } from "@/lib/i18n/format";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/sim-messages";
import { requireUser } from "@/server/auth/session";
import { cancelEvidenceJob, requestEvidence } from "@/server/evidence/actions";
import { getFieldEvidence } from "@/server/evidence/queries";
import {
  addCropHistory,
  addSoilObservation,
  createScenario,
  createZone,
  deleteOwnedRecord,
  saveFarmerPriorities,
  saveFieldConstraints,
  setFieldBoundary,
} from "@/server/farm/actions";
import { fieldFacts, getField } from "@/server/farm/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.rec.metaTitle") };
}

const humanise = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const has = (k: string): k is MessageKey => k in MESSAGES.en;

export default async function FieldPage({ params, searchParams }: PageProps<"/fields/[fieldId]/records">) {
  const t = await getT();
  const f = formatterFor(await getLocale());
  /** A stored code shown in the farmer's language (`app.rec.<group>.<code>`), falling back to a readable form of the code. */
  const label = (group: string, code: string) => {
    const k = `app.rec.${group}.${code}`;
    return has(k) ? t(k) : humanise(code);
  };
  const opts = (group: string, values: readonly string[], blank?: string) => [...(blank !== undefined ? [{ value: "", label: blank }] : []), ...values.map((v) => ({ value: v, label: label(group, v) }))];
  /** Plain words for the 0–5 weights the engine uses. */
  const importance = [0, 1, 2, 3, 4, 5].map((n) => t(`app.rec.importance.${n}` as MessageKey));

  const { fieldId } = await params;
  const user = await requireUser(`/fields/${fieldId}/records`);
  if (user.state !== "signed_in") return <SetupRequired feature="Saving fields" reason={user.state} />;
  if (!/^[0-9a-f-]{36}$/i.test(fieldId)) notFound();
  const field = await getField(user.supabase, fieldId);
  if (!field) notFound();
  const facts = (await fieldFacts(user.supabase, [field.id])).get(field.id)!;
  const steps = fieldSteps(field.id, facts);
  const state = (id: string) => steps.find((s) => s.id === id)!;
  const zoneOptions = [{ value: "", label: t("ws.wholeField") }, ...field.zones.map((z) => ({ value: z.id, label: z.name }))];
  const zoneName = (id: string | null) => (id ? (field.zones.find((z) => z.id === id)?.name ?? t("app.rec.zone")) : t("ws.wholeField"));
  const lastYear = new Date().getUTCFullYear() - 1;
  const date = (iso: string) => f.date(iso);
  const soilCount = field.soil.length;
  const history = state("history");
  // Weather and soil open over the steps right after the priorities are saved (`?evidence=1`); loaded only then.
  const boundary = field.geometry.boundary;
  const sp = await searchParams;
  const showEvidence = sp.evidence === "1" && boundary !== null;
  // After a Water & Energy save the planner sends the farmer back here (`?waterSaved=<version>`) to see the next step.
  const waterSaved = typeof sp.waterSaved === "string" && /^\d{1,6}$/.test(sp.waterSaved) ? Number(sp.waterSaved) : null;
  const evidence = showEvidence ? await getFieldEvidence(user.supabase, field.id) : null;
  const requestSources = async (sources: Parameters<typeof requestEvidence>[1]) => {
    "use server";
    return requestEvidence(fieldId, sources);
  };
  const cancelJob = async (jobId: string) => {
    "use server";
    return cancelEvidenceJob(fieldId, jobId);
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <PageHeader
        crumbs={[{ href: "/workspace", label: t("app.ws.title") }, { href: `/farms/${field.farm_id}`, label: field.farmName }]}
        title={field.name}
        eyebrow={field.farmName}
        subtitle={field.area_ha !== null ? fmt(t("app.rec.subtitle"), { ha: f.num(Number(field.area_ha), 2) }) : t("app.rec.subtitleNoShape")}
        actions={
          <>
            <ButtonLink href={`/fields/${field.id}`} variant="outlined" startIcon={<ViewInArRoundedIcon />}>
              {t("ws.view3d")}
            </ButtonLink>
            <ButtonLink href={`/fields/${field.id}/evidence`} variant="outlined" startIcon={<WbSunnyRoundedIcon />}>
              {t("app.rec.weatherSoil")}
            </ButtonLink>
            {field.area_ha !== null && (
              <ButtonLink href={`/fields/${field.id}/water`} variant="outlined" startIcon={<WaterDropRoundedIcon />}>
                {t("app.water.title")}
              </ButtonLink>
            )}
          </>
        }
      />

      {waterSaved !== null && (
        <Alert severity="success" role="status" sx={{ mb: 2 }}>
          {fmt(t("app.rec.waterSaved"), { v: f.int(waterSaved) })}
        </Alert>
      )}
      <StepGuide steps={steps} />
      {evidence && boundary && (
        // eslint-disable-next-line react-hooks/purity
        <EvidenceDialog fieldId={field.id} evidence={evidence} actions={{ request: requestSources, cancel: cancelJob }} boundary={boundary} zones={field.geometry.zones} renderedAt={Date.now()} />
      )}

      <Section
        id="history"
        step={1}
        icon={<GrassRoundedIcon />}
        title={t("app.rec.history.title")}
        aside={<StatusChip done={history.state === "done"} label={stepText(history, t, f.int).status} />}
        intro={t("app.rec.history.intro")}
      >
        {field.history.length === 0 ? (
          <Empty>{t("app.rec.history.empty")}</Empty>
        ) : (
          <RecordList
            label={t("app.rec.history.list")}
            items={field.history.map((h) => ({
              key: h.id,
              primary: `${f.digits(String(h.season_year))} · ${h.crop_name}`,
              secondary: [
                label("season", h.season),
                zoneName(h.zone_id),
                h.planted_on ? fmt(t("app.rec.history.planted"), { date: date(h.planted_on) }) : t("app.rec.history.noPlanted"),
                h.harvested_on ? fmt(t("app.rec.history.harvested"), { date: date(h.harvested_on) }) : t("app.rec.history.noHarvested"),
                h.tillage && label("tillage", h.tillage),
                h.reported_yield !== null && fmt(t("app.rec.history.yield"), { value: f.num(Number(h.reported_yield), 2), unit: h.reported_yield_unit ?? "" }),
              ]
                .filter(Boolean)
                .join(" · "),
              action: <DeleteButton action={deleteOwnedRecord.bind(null, "crop_history", h.id, field.id)} label={fmt(t("app.rec.history.deleteAria"), { year: h.season_year, crop: h.crop_name })} />,
            }))}
          />
        )}
        <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
          {t("app.step.action.addSeason")}
        </Typography>
        <ActionForm action={addCropHistory.bind(null, field.id)} submitLabel={t("app.rec.history.submit")} direction="row" successMessage={t("app.rec.history.added")}>
          <FormField name="cropName" label={t("ws.crop")} required placeholder={t("app.rec.history.cropPlaceholder")} sx={{ minWidth: 220 }} />
          <FormField name="seasonYear" label={t("ws.year")} type="number" required defaultValue={lastYear} sx={{ width: 110 }} />
          <FormSelect name="season" label={t("ws.season")} options={opts("season", SEASONS)} sx={{ minWidth: 150 }} />
          <FormField name="plantedOn" label={t("app.rec.history.plantedOn")} type="date" slotProps={{ inputLabel: { shrink: true } }} />
          <FormField name="harvestedOn" label={t("app.rec.history.harvestedOn")} type="date" slotProps={{ inputLabel: { shrink: true } }} />
          <More>
            <FormSelect name="zoneId" label={t("app.rec.partOfField")} options={zoneOptions} sx={{ minWidth: 170 }} />
            <FormSelect name="tillage" label={t("app.rec.history.tillage")} options={opts("tillage", TILLAGE, t("app.rec.notRecorded"))} sx={{ minWidth: 150 }} />
            <FormField name="reportedYield" label={t("app.rec.history.yieldLabel")} type="number" sx={{ width: 150 }} />
            <FormField name="reportedYieldUnit" label={t("app.rec.history.yieldUnit")} helperText={t("app.rec.history.yieldUnitHelp")} sx={{ width: 200 }} />
          </More>
        </ActionForm>
      </Section>

      <Section
        id="soil"
        step={2}
        icon={<AgricultureRoundedIcon />}
        title={t("app.rec.soil.title")}
        aside={
          <StatusChip
            done={soilCount > 0 || facts.hasSoilSurvey}
            label={soilCount ? fmt(t(soilCount === 1 ? "app.step.status.soilTests.one" : "app.step.status.soilTests"), { n: f.int(soilCount) }) : facts.hasSoilSurvey ? t("app.step.status.soilSurvey") : t("app.step.state.optional")}
          />
        }
        intro={
          <>
            {t("app.rec.soil.intro1")} <strong>{t("app.rec.soil.awc")}</strong> {t("app.rec.soil.intro2")}
          </>
        }
      >
        {soilCount === 0 ? (
          <Empty>
            {t("app.rec.soil.empty")}
            {facts.hasSoilSurvey ? ` ${t("app.rec.soil.emptySurvey")}` : ""}
          </Empty>
        ) : (
          <RecordList
            label={t("app.rec.soil.list")}
            items={field.soil.map((s) => ({
              key: s.id,
              primary: (
                <>
                  {s.property in SOIL_PROPERTIES ? label("soilProp", s.property) : s.property}: {s.value_numeric ?? s.value_text} {s.unit ?? ""}{" "}
                  <EvidenceChip evidenceClass={s.evidence_class as "ground_measurement" | "farmer_report"} />
                </>
              ),
              secondary: [s.observed_on && date(s.observed_on), fmt(t("app.rec.soil.depth"), { top: f.int(s.depth_top_cm), bottom: f.int(s.depth_bottom_cm) }), zoneName(s.zone_id), s.method, s.source].filter(Boolean).join(" · "),
              action: <DeleteButton action={deleteOwnedRecord.bind(null, "soil_observations", s.id, field.id)} label={fmt(t("app.rec.soil.deleteAria"), { date: s.observed_on ? date(s.observed_on) : "" })} />,
            }))}
          />
        )}
        <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
          {t("app.rec.soil.addTitle")}
        </Typography>
        <ActionForm action={addSoilObservation.bind(null, field.id)} submitLabel={t("app.rec.soil.submit")} direction="row" successMessage={t("app.rec.soil.added")}>
          <FormSelect
            name="property"
            label={t("app.rec.soil.property")}
            options={Object.entries(SOIL_PROPERTIES).map(([k, v]) => ({ value: k, label: v.unit ? `${label("soilProp", k)} (${v.unit})` : label("soilProp", k) }))}
            defaultValue="available_water_capacity"
            sx={{ minWidth: 280 }}
          />
          <FormField name="value" label={t("app.rec.soil.value")} required sx={{ width: 140 }} />
          <FormField name="observedOn" label={t("app.rec.soil.sampledOn")} type="date" required slotProps={{ inputLabel: { shrink: true } }} />
          <More label={t("app.rec.soil.more")}>
            <FormField name="depthTopCm" label={t("app.rec.soil.fromDepth")} type="number" required defaultValue={0} sx={{ width: 150 }} />
            <FormField name="depthBottomCm" label={t("app.rec.soil.toDepth")} type="number" required defaultValue={100} helperText={t("app.rec.soil.toDepthHelp")} sx={{ width: 220 }} />
            <FormSelect name="zoneId" label={t("app.rec.partOfField")} options={zoneOptions} sx={{ minWidth: 170 }} />
            <FormSelect name="evidenceClass" label={t("app.rec.soil.who")} options={[{ value: "ground_measurement", label: t("app.rec.soil.whoLab") }, { value: "farmer_report", label: t("app.rec.soil.whoMe") }]} />
            <FormField name="method" label={t("app.rec.soil.method")} helperText={t("app.rec.soil.methodHelp")} />
            <FormField name="source" label={t("app.rec.soil.source")} />
          </More>
        </ActionForm>
      </Section>

      <Section
        id="water"
        step={3}
        icon={<WaterDropRoundedIcon />}
        title={t("app.rec.water.title")}
        aside={<StatusChip done={facts.waterSaved} label={facts.waterSaved ? t("app.rec.saved") : t("app.rec.notSet")} />}
        intro={t("app.rec.water.intro")}
      >
        <ActionForm action={saveFieldConstraints.bind(null, field.id)} submitLabel={t("app.rec.water.submit")} successMessage={t("app.rec.savedDot")}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <FormSelect name="irrigation" label={t("app.rec.water.irrigation")} options={IRRIGATION.map((v) => ({ value: v, label: label("irrigation", v) }))} defaultValue={field.constraints?.irrigation ?? "unknown"} sx={{ minWidth: 240 }} />
            <FormSelect name="irrigationMethod" label={t("app.rec.water.method")} options={opts("irrigationMethod", IRRIGATION_METHODS, t("app.rec.none"))} defaultValue={field.constraints?.irrigation_method ?? ""} />
            <FormField name="seasonalWaterAllocationMm" label={t("app.rec.water.allocation")} type="number" defaultValue={field.constraints?.seasonal_water_allocation_mm ?? ""} sx={{ minWidth: 260 }} />
            <FormField name="waterSource" label={t("app.rec.water.source")} placeholder={t("app.rec.water.sourcePlaceholder")} defaultValue={field.constraints?.water_source ?? ""} />
          </Stack>
          <More label={t("app.rec.water.machinesMore")} open={Boolean(field.constraints?.equipment.length)}>
            <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, width: "100%" }}>
              <Typography component="legend" variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {t("app.rec.water.machines")}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                {EQUIPMENT.map((e) => (
                  <FormCheckbox key={e} name="equipment" value={e} label={label("equipment", e)} defaultChecked={field.constraints?.equipment.includes(e)} />
                ))}
              </Box>
              <FormField name="equipmentNotes" label={t("app.rec.water.machineNotes")} fullWidth defaultValue={field.constraints?.equipment_notes ?? ""} sx={{ mt: 1 }} />
            </Box>
          </More>
        </ActionForm>
      </Section>

      <Section
        id="priorities"
        step={4}
        icon={<TuneRoundedIcon />}
        title={t("app.step.priorities.title")}
        aside={<StatusChip done={facts.prioritiesSaved} label={facts.prioritiesSaved ? t("app.rec.saved") : t("app.rec.notSet")} />}
        intro={t("app.rec.prio.intro")}
      >
        <ActionForm action={saveFarmerPriorities.bind(null, field.id)} submitLabel={t("app.rec.prio.submit")} successMessage={t("app.rec.prio.saved")} successHref={boundary ? `/fields/${field.id}/records?evidence=1` : undefined}>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" } }}>
            {PRIORITY_KEYS.map((k) => (
              <FormSelect key={k} name={k} label={label("priority", k)} options={importance.map((text, n) => ({ value: String(n), label: text }))} defaultValue={String(field.priorities?.[k] ?? 3)} sx={{ minWidth: 0, width: "100%" }} />
            ))}
          </Box>
          <FormField name="excludedCrops" label={t("app.rec.prio.excluded")} helperText={t("app.rec.prio.excludedHelp")} defaultValue={field.priorities?.excluded_crops.join(", ") ?? ""} sx={{ maxWidth: 520 }} />
        </ActionForm>
      </Section>

      <Section
        id="compare"
        step={5}
        icon={<CompareArrowsRoundedIcon />}
        title={t("app.step.compare.title")}
        aside={<StatusChip done={Boolean(facts.latestRunId)} label={facts.latestRunId ? t("app.step.resultsReady") : field.scenarios.length ? t("app.rec.cmp.setUp") : t("app.step.status.compareNone")} />}
        intro={
          <>
            {t("app.rec.cmp.intro")}
            {!facts.hasWeather && (
              <>
                {" "}
                {t("app.rec.cmp.first")} <TextLink href={`/fields/${field.id}/evidence`}>{t("app.rec.cmp.getWeather")}</TextLink>.
              </>
            )}
          </>
        }
      >
        {field.scenarios.length > 0 && (
          <RecordList
            label={t("app.rec.cmp.list")}
            items={field.scenarios.map((s) => ({
              key: s.id,
              primary: <TextLink href={`/scenarios/${s.id}`}>{s.name}</TextLink>,
              secondary: `${s.snapshotCount ? (s.snapshotCount === 1 ? t("app.rec.cmp.runOnce") : fmt(t("app.rec.cmp.runTimes"), { n: f.int(s.snapshotCount) })) : t("app.rec.cmp.notRun")} · ${fmt(t("app.rec.cmp.updated"), { date: date(new Date(s.updated_at).toISOString().slice(0, 10)) })}`,
              action: (
                <ButtonLink href={`/scenarios/${s.id}`} size="small" variant="outlined">
                  {t("app.rec.open")}
                </ButtonLink>
              ),
            }))}
          />
        )}
        <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
          {field.scenarios.length ? t("app.rec.cmp.another") : t("app.step.action.startComparison")}
        </Typography>
        <ActionForm action={createScenario.bind(null, field.id)} submitLabel={t("app.rec.cmp.submit")} direction="row">
          <FormField name="name" label={t("app.rec.name")} required defaultValue={field.scenarios.length ? "" : t("app.rec.cmp.defaultName")} sx={{ minWidth: 220 }} />
          <Box sx={{ minWidth: 320, flexGrow: 1 }}>
            <CropPickerField />
          </Box>
          <More label={t("app.rec.cmp.more")}>
            <FormField name="rotationYears" label={t("app.rec.cmp.years")} type="number" defaultValue={2} sx={{ width: 190 }} />
            <FormField name="replayFromYear" label={t("app.rec.cmp.from")} type="number" defaultValue={lastYear - 19} sx={{ width: 160 }} />
            <FormField name="replayToYear" label={t("app.rec.cmp.to")} type="number" defaultValue={lastYear} sx={{ width: 160 }} />
            <FormSelect name="irrigationAssumption" label={t("app.rec.water.irrigation")} options={IRRIGATION_ASSUMPTIONS.map((v) => ({ value: v, label: label("assumption", v) }))} />
          </More>
        </ActionForm>
      </Section>

      <Typography variant="overline" component="h2" sx={{ display: "block", mt: 4, mb: 1, color: "text.secondary", fontWeight: 700 }}>
        {t("app.rec.advanced")}
      </Typography>

      <Section id="boundary" collapsible icon={<PolylineRoundedIcon />} title={t("app.rec.shape.title")} intro={t("app.rec.shape.intro")}>
        <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
          {t("app.rec.shape.shape")}
        </Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ mb: 3 }}>
          <Box sx={{ flexShrink: 0 }}>
            {field.geometry.boundary ? <BoundaryPreview boundary={field.geometry.boundary} zones={field.geometry.zones} label={fmt(t("app.rec.shape.outline"), { name: field.name })} /> : <Empty>{t("app.rec.shape.none")}</Empty>}
          </Box>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <ActionForm action={setFieldBoundary.bind(null, field.id)} submitLabel={field.geometry.boundary ? t("app.rec.shape.replace") : t("app.rec.shape.save")}>
              <FormField
                name="boundary"
                label={t("app.rec.shape.geojson")}
                multiline
                minRows={4}
                maxRows={12}
                fullWidth
                defaultValue={field.geometry.boundary ? JSON.stringify(field.geometry.boundary) : ""}
                helperText={t("app.rec.shape.geojsonHelp")}
                slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: "monospace", fontSize: "0.8rem" } } }}
              />
              <FormSelect
                name="source"
                label={t("app.rec.shape.from")}
                options={[
                  { value: "farmer_entered_coordinates", label: t("app.rec.shape.fromTyped") },
                  { value: "farmer_uploaded", label: t("app.rec.shape.fromTool") },
                ]}
                defaultValue={field.boundary_source ?? "farmer_entered_coordinates"}
              />
            </ActionForm>
          </Box>
        </Stack>

        <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
          {t("app.rec.zones.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, maxWidth: 720 }}>
          {t("app.rec.zones.intro")}
        </Typography>
        {field.zones.length === 0 ? (
          <Empty>{t("app.rec.zones.empty")}</Empty>
        ) : (
          <RecordList
            label={t("app.rec.zones.list")}
            items={field.zones.map((z) => ({
              key: z.id,
              primary: z.name,
              secondary: `${fmt(t("app.card.ha"), { n: f.num(Number(z.area_ha), 2) })} · ${(ZONE_BASES as readonly string[]).includes(z.basis) ? label("zoneBasis", z.basis) : z.basis}${z.notes ? ` · ${z.notes}` : ""}`,
              action: <DeleteButton action={deleteOwnedRecord.bind(null, "planting_zones", z.id, field.id)} label={fmt(t("app.rec.zones.deleteAria"), { name: z.name })} />,
            }))}
          />
        )}
        {field.geometry.boundary ? (
          <ActionForm action={createZone.bind(null, field.id)} submitLabel={t("app.rec.zones.submit")}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormField name="name" label={t("app.rec.name")} required />
              <FormSelect name="basis" label={t("app.rec.zones.basis")} options={ZONE_BASES.map((b) => ({ value: b, label: label("zoneBasis", b) }))} />
              <FormField name="notes" label={t("app.rec.notes")} sx={{ flexGrow: 1 }} />
            </Stack>
            <FormField name="boundary" label={t("app.rec.zones.geojson")} multiline minRows={3} fullWidth slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: "monospace", fontSize: "0.8rem" } } }} />
          </ActionForm>
        ) : (
          <Empty>{t("app.rec.zones.needShape")}</Empty>
        )}
      </Section>

      <Section id="delete" collapsible tone="danger" icon={<DeleteOutlineRoundedIcon />} title={t("app.rec.del.title")} intro={t("app.rec.del.intro")}>
        <DeleteButton action={deleteOwnedRecord.bind(null, "fields", field.id, field.farm_id)} label={fmt(t("app.rec.del.aria"), { name: field.name })} confirmLabel={t("app.rec.del.confirm")} />
      </Section>
    </Container>
  );
}
