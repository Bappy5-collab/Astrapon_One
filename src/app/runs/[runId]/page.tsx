import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";

import { RunFixList } from "@/components/compare/RunGlance";
import { ZoneComparison } from "@/components/compare/ZoneComparison";
import { VoiceResult } from "@/components/compare/VoiceResult";
import { RunWaterCard } from "@/components/water/RunWaterCard";
import { demandFromResult } from "@/domain/water/demand";
import type { PlannerResult } from "@/domain/water/plan";
import { notFound } from "next/navigation";

import { RunExplorer } from "@/components/compare/RunExplorer";
import type { Weights } from "@/components/compare/ComparePanel";
import { EvidenceChip, PageHeader } from "@/components/farm/ui";
import { SetupRequired } from "@/components/SetupRequired";
import { RunResult } from "@/components/simulation/RunResult";
import { RUN_STATUS } from "@/components/simulation/status";
import type { RunView } from "@/domain/simulation/engine";
import { getLocale, getT } from "@/lib/i18n/server";
import { draftExplanation } from "@/server/ai/actions";
import { aiConfigured } from "@/server/ai/explain";
import { requireUser } from "@/server/auth/session";
import { requestSimulation } from "@/server/simulation/actions";
import { deletePlan, deleteRun, savePlan, savePrioritiesAndRun, updatePlan } from "@/server/simulation/plans";
import { getRunPage } from "@/server/simulation/queries";
import { runVoiceLines } from "@/server/voice/script";
import { voiceConfigured } from "@/server/voice/tts";
import { numeric, radius } from "@/theme/tokens";

export const metadata: Metadata = { title: "Run result" };

export default async function RunPage({ params }: PageProps<"/runs/[runId]">) {
  const { runId } = await params;
  const user = await requireUser(`/runs/${runId}`);
  if (user.state !== "signed_in") return <SetupRequired feature="Saved runs" reason={user.state} />;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const data = await getRunPage(user.supabase, runId);
  if (!data) notFound();
  const t = await getT();
  const { run, result, scenario } = data;
  // Spoken summary: same sentences on screen and in the audio; hidden when no voice key is set.
  const voiceLines = result && run.status === "succeeded" && voiceConfigured() ? ((await runVoiceLines(user.supabase, run.id, await getLocale())) ?? []) : [];
  const st = RUN_STATUS[run.status];
  const crumbs = [{ href: "/runs", label: t("nav.runs") }, ...(scenario ? [{ href: `/fields/${scenario.fieldId}/records`, label: scenario.fieldName }, { href: `/scenarios/${scenario.id}`, label: "Settings" }] : [])];
  const scenarioId = scenario?.id ?? null;
  const water = result && scenario && run.status === "succeeded" ? await user.supabase.from("water_energy_plans").select("id, version, name, created_at, result").eq("run_id", run.id).order("version", { ascending: false }).limit(1).maybeSingle() : null;

  const rerun = async () => {
    "use server";
    return requestSimulation(scenarioId!);
  };
  const savePriorities = async (w: Weights) => {
    "use server";
    return savePrioritiesAndRun(scenarioId!, w);
  };
  const draft = async (input: { runId: string; runKind: RunView["kind"]; focus: string; locale: "en" | "bn" }) => {
    "use server";
    return draftExplanation(input);
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader crumbs={crumbs} title={scenario ? scenario.name : t("sim.title")} eyebrow={scenario ? `${t("sim.title")} · ${scenario.fieldName}` : undefined}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          <Chip size="small" label={t(`sim.status.${run.status}`)} sx={{ bgcolor: st.bg, color: st.fg, fontWeight: 600 }} />
          <EvidenceChip evidenceClass="simulation_output" />
          <Typography variant="body2" color="text.secondary" sx={numeric} title={`engine ${run.engineVersion}${run.computeMs != null ? ` · ${run.computeMs} ms` : ""}`}>
            {run.queuedAt.slice(0, 10)}
          </Typography>
        </Stack>
      </PageHeader>
      {run.status === "failed" && <Alert severity="error">{run.errorMessage ?? "The run failed."}</Alert>}
      {(run.status === "queued" || run.status === "running") && <Alert severity="info">{t("sim.waiting")}</Alert>}
      {run.status === "cancelled" && <Alert severity="info">{t("sim.status.cancelled")}</Alert>}
      {voiceLines.length > 0 && <VoiceResult runId={run.id} lines={voiceLines} />}
      {result && scenario && <RunFixList result={result} fieldId={scenario.fieldId} scenarioId={scenarioId} />}
      {result && (
        <RunExplorer
          runId={run.id}
          result={result}
          plans={data.plans}
          geometry={data.geometry?.boundary ? { boundary: data.geometry.boundary, zones: data.geometry.zones } : null}
          outdated={data.outdated}
          snapshotDate={data.snapshotCreatedAt}
          scenarioId={scenarioId}
          aiAvailable={aiConfigured()}
          details={<RunResult result={result} resultSha256={run.resultSha256} inputDigest={run.inputDigest} />}
          actions={{ save: savePlan, update: updatePlan, remove: deletePlan, deleteRun, rerun: scenarioId ? rerun : null, savePriorities: scenarioId ? savePriorities : null, draft }}
        />
      )}
      {result?.zones && result.zones.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <ZoneComparison zones={result.zones} />
        </Box>
      )}
      {result && scenario && run.status === "succeeded" && (
        <Box id="voice-water" sx={{ mt: 3, borderRadius: `${radius.lg}px` }}>
          <RunWaterCard
            fieldId={scenario.fieldId}
            runId={run.id}
            demand={demandFromResult(result)}
            saved={water?.data ? { id: water.data.id, version: water.data.version, name: water.data.name, createdAt: water.data.created_at, result: water.data.result as unknown as PlannerResult } : null}
          />
        </Box>
      )}
    </Container>
  );
}
