import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeleteButton } from "@/components/farm/DeleteButton";
import { PageHeader, RecordList, Section } from "@/components/farm/ui";
import { ButtonLink, TextLink } from "@/components/links";
import { SetupRequired } from "@/components/SetupRequired";
import { WaterPlanner } from "@/components/water/WaterPlanner";
import { formatterFor } from "@/lib/i18n/format";
import { getLocale, getT } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/sim-messages";
import { requireUser } from "@/server/auth/session";
import { getField } from "@/server/farm/queries";
import { deleteWaterPlan, findGroundwater, findSurfaceWater, loadSolar, saveWaterPlan } from "@/server/water/actions";
import { graceContext } from "@/server/water/grace";
import { getFieldWeatherSeries, listFieldRunDemands, listWaterPlans } from "@/server/water/queries";
import { drySeasonOutlook } from "@/domain/water/dryseason";
import { fieldFrame } from "@/domain/water/distance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.water.title") };
}

export default async function WaterPage({ params, searchParams }: PageProps<"/fields/[fieldId]/water">) {
  const t = await getT();
  const f = formatterFor(await getLocale());
  const { fieldId } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/fields/${fieldId}/water`);
  if (user.state !== "signed_in") return <SetupRequired feature="Water & Energy" reason={user.state} />;
  if (!/^[0-9a-f-]{36}$/i.test(fieldId)) notFound();
  const field = await getField(user.supabase, fieldId);
  if (!field) notFound();
  const crumbs = [{ href: "/workspace", label: t("app.ws.title") }, { href: `/fields/${fieldId}/records`, label: field.name }];
  if (!field.geometry.boundary)
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <PageHeader crumbs={crumbs} title={t("app.water.title")} />
        <Typography>{t("app.water.page.drawFirst")}</Typography>
        <ButtonLink href={`/fields/${fieldId}`} variant="contained" sx={{ mt: 2 }}>
          {t("app.step.action.draw")}
        </ButtonLink>
      </Container>
    );
  const [runs, plans, weather] = await Promise.all([listFieldRunDemands(user.supabase, fieldId), listWaterPlans(user.supabase, fieldId), getFieldWeatherSeries(user.supabase, fieldId).catch(() => null)]);
  // Weather-based dry-season indicator from the stored series (NASA IMERG rain when stored, else POWER; no download here).
  const origin = fieldFrame(field.geometry.boundary).origin;
  const grace = await graceContext(origin[1], origin[0]).catch(() => null);
  const outlook = weather ? { ...drySeasonOutlook(weather, fieldFrame(field.geometry.boundary).origin[1]), retrievalId: weather.retrievalId, retrievedAt: weather.retrievedAt, rainSource: weather.rainSource, rainRetrievedAt: weather.rainRetrievedAt } : null;
  const runParam = typeof sp.run === "string" ? sp.run : null;

  const surface = async (r: number) => {
    "use server";
    return findSurfaceWater(fieldId, r);
  };
  const groundwater = async (r: number) => {
    "use server";
    return findGroundwater(fieldId, r);
  };
  const solar = async () => {
    "use server";
    return loadSolar(fieldId);
  };
  const save = async (raw: unknown) => {
    "use server";
    return saveWaterPlan(fieldId, raw);
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader
        crumbs={crumbs}
        title={t("app.water.title")}
        eyebrow={field.name}
        subtitle={t("app.water.page.subtitle")}
        actions={
          <ButtonLink href={`/fields/${fieldId}/records`} variant="outlined">
            {t("app.ev.back")}
          </ButtonLink>
        }
      />
      <WaterPlanner
        key={fieldId}
        fieldId={fieldId}
        fieldName={field.name}
        boundary={field.geometry.boundary}
        areaHa={Number(field.area_ha) || 0.01}
        runs={runs.map((r) => ({ runId: r.runId, resultSha256: r.resultSha256, scenarioName: r.scenarioName, finishedAt: r.finishedAt, demand: r.demand }))}
        initialRunId={runParam}
        outlook={outlook}
        grace={grace}
        actions={{ surface, groundwater, solar, save }}
      />
      <Section title={t("app.water.page.saved")} intro={t("app.water.page.savedIntro")}>
        {plans.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("app.water.page.nothingSaved")}
          </Typography>
        ) : (
          <RecordList
            label={t("app.water.page.savedList")}
            items={plans.map((p) => ({
              key: p.id,
              primary: <TextLink href={`/fields/${fieldId}/water/plans/${p.id}`}>{`v${p.version} · ${p.name}`}</TextLink>,
              secondary: fmt(t("app.water.page.savedLine"), {
                date: `${f.date(p.createdAt.slice(0, 10))} ${f.digits(p.createdAt.slice(11, 16))} UTC`,
                model: p.modelVersion,
                n: f.int(p.result.options.length),
                source: p.inputs.source.kind === "well" ? t("app.water.page.well") : t("app.water.page.surface"),
              }),
              action: (
                <DeleteButton
                  label={fmt(t("app.water.page.deleteAria"), { v: p.version })}

                  action={async () => {
                    "use server";
                    await deleteWaterPlan(fieldId, p.id);
                  }}
                />
              ),
            }))}
          />
        )}
      </Section>
    </Container>
  );
}
