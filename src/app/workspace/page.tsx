import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AgricultureRoundedIcon from "@mui/icons-material/AgricultureRounded";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";

import { FieldCard, FieldGrid } from "@/components/farm/FieldCard";
import { PageHeader } from "@/components/farm/ui";
import { ButtonLink } from "@/components/links";
import { fieldSteps } from "@/domain/farm/progress";
import { getT } from "@/lib/i18n/server";
import { getAuth } from "@/server/auth/session";
import { fieldFacts } from "@/server/farm/queries";
import { color, elevation, radius, tokens } from "@/theme/tokens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.ws.title") };
}

/** The farmer's home: every field with how far it is, and the one next thing to do. */
export default async function MyFieldsPage() {
  const t = await getT();
  const auth = await getAuth();
  const PATH = [t("app.ws.path1"), t("app.ws.path2"), t("app.ws.path3"), t("app.ws.path4"), t("app.ws.path5")];
  let fields: { id: string; name: string; area_ha: number | null; farmName: string }[] | null = null;
  let facts = new Map<string, Parameters<typeof fieldSteps>[1]>();
  if (auth.state === "signed_in") {
    const { data } = await auth.supabase.from("fields").select("id, name, area_ha, farms(name)").order("updated_at", { ascending: false }).limit(50);
    fields = (data ?? []).map((f) => ({ id: f.id, name: f.name, area_ha: f.area_ha === null ? null : Number(f.area_ha), farmName: (f.farms as unknown as { name: string } | null)?.name ?? "" }));
    facts = await fieldFacts(auth.supabase, fields.map((f) => f.id));
  }
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <PageHeader
        crumbs={[]}
        title={t("app.ws.title")}
        subtitle={t("app.ws.subtitle")}
        actions={
          fields !== null && (
            <>
              <ButtonLink href="/fields/new" variant="contained" startIcon={<AddRoundedIcon />} data-tour="add-field">
                {t("app.ws.addField")}
              </ButtonLink>
              <ButtonLink href="/farms" variant="outlined">
                {t("app.ws.manageFarms")}
              </ButtonLink>
            </>
          )
        }
      />
      {fields === null || fields.length === 0 ? (
        <Box sx={{ p: { xs: 3, md: 5 }, borderRadius: `${radius.lg + 4}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised, boxShadow: elevation.raised, textAlign: "center" }}>
          <Box aria-hidden sx={{ width: 64, height: 64, mx: "auto", mb: 2, borderRadius: "18px", display: "grid", placeItems: "center", bgcolor: tokens.lime[200], color: tokens.forest[800] }}>
            <AgricultureRoundedIcon sx={{ fontSize: 34 }} />
          </Box>
          <Typography variant="h5" component="h2">
            {fields === null ? t("app.ws.signInTitle") : t("app.ws.firstTitle")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3, maxWidth: 520, mx: "auto" }}>
            {fields === null ? t("app.ws.signInBody") : t("app.ws.firstBody")}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ justifyContent: "center" }}>
            <ButtonLink href={fields === null ? "/sign-in?next=/workspace" : "/fields/new"} variant="contained" size="large">
              {fields === null ? t("nav.signIn") : t("app.ws.addField")}
            </ButtonLink>
            <ButtonLink href="/sample" variant="outlined" size="large">
              {t("app.ws.trySample")}
            </ButtonLink>
          </Stack>
        </Box>
      ) : (
        <>
          {![...facts.values()].some((f) => f.waterPlanCount > 0) && (
            <Box component="section" aria-labelledby="path-title" sx={{ mb: 3, p: { xs: 2, md: 2.5 }, borderRadius: `${radius.lg + 4}px`, bgcolor: tokens.forest[900], color: color.onForest }}>
              <Typography id="path-title" variant="h6" component="h2" sx={{ color: color.accent }}>
                {t("app.ws.pathTitle")}
              </Typography>
              <Box component="ol" sx={{ m: 0, mt: 1.5, p: 0, listStyle: "none", display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(5, 1fr)" } }}>
                {PATH.map((line, i) => (
                  <Stack component="li" key={line} direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
                    <Box aria-hidden sx={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: color.accent, color: color.accentInk, fontWeight: 800, fontSize: "0.9rem" }}>
                      {i + 1}
                    </Box>
                    <Typography variant="body2" sx={{ color: color.onForest, pt: 0.4 }}>
                      {line}
                    </Typography>
                  </Stack>
                ))}
              </Box>
              <Typography variant="caption" component="p" sx={{ mt: 1.5, color: color.onForestMuted }}>
                {t("app.ws.pathNote")}
              </Typography>
            </Box>
          )}
          <div data-tour="fields"><FieldGrid label={t("app.ws.yourFields")}>
            {fields.map((f) => (
              <FieldCard key={f.id} id={f.id} name={f.name} farmName={f.farmName} areaHa={f.area_ha} steps={fieldSteps(f.id, facts.get(f.id) ?? EMPTY)} />
            ))}
            <Box component="li" sx={{ minHeight: 180 }}>
              <ButtonLink
                href="/fields/new"
                startIcon={<AddRoundedIcon />}
                sx={{ width: "100%", height: "100%", minHeight: 180, borderRadius: `${radius.lg + 4}px`, border: `2px dashed ${color.lineStrong}`, color: tokens.forest[700], fontWeight: 700, "&:hover": { borderColor: tokens.forest[500], bgcolor: color.surfaceRaised } }}
              >
                {t("app.ws.addAnother")}
              </ButtonLink>
            </Box>
          </FieldGrid></div>
        </>
      )}
    </Container>
  );
}



const EMPTY = { hasBoundary: false, historyCount: 0, datedHistoryCount: 0, soilCount: 0, hasSoilSurvey: false, waterSaved: false, prioritiesSaved: false, hasWeather: false, weatherPending: false, scenarioCount: 0, latestRunId: null, waterPlanCount: 0 };
