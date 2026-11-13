import Alert from "@mui/material/Alert";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { RunExplorer } from "@/components/compare/RunExplorer";
import { RunFixList } from "@/components/compare/RunGlance";
import { ExampleGuide } from "@/components/example/ExampleGuide";
import { EvidenceChip, PageHeader } from "@/components/farm/ui";
import { ButtonLink } from "@/components/links";
import { RunResult } from "@/components/simulation/RunResult";
import type { BoundaryGeometry } from "@/domain/geo/boundary";
import type { EngineResult } from "@/domain/simulation/engine";
import type { DrySeasonOutlook } from "@/domain/water/dryseason";
import type { GraceContext } from "@/domain/water/grace";
import type { PlannerInput, PlannerResult } from "@/domain/water/plan";
import { GraceCard } from "@/components/water/GraceCard";
import { ResultsView } from "@/components/water/ResultsView";
import Box from "@mui/material/Box";

export const metadata: Metadata = {
  title: "Real example: Rajshahi",
  description: "A real Astrapon comparison on live NASA POWER weather and a SoilGrids soil estimate for a test square near Rajshahi, Bangladesh. No account needed.",
};

type Example = {
  builtAt: string;
  place: { name: string; lat: number; lon: number };
  illustrativeHistory: string;
  scenario: { name: string };
  engineVersion: string;
  resultSha256: string;
  geometry: { boundary: BoundaryGeometry; zones: [] };
  result: EngineResult & { inputDigest?: string };
  water?: { input: PlannerInput; result: PlannerResult; note: string };
  grace?: GraceContext | null;
  outlook?: DrySeasonOutlook & { retrievedAt: string };
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const READ_ONLY = { ok: false, message: "This is a read-only example. Create a free account to save plans, change priorities or run your own field." };

export default async function ExamplePage() {
  const ex = JSON.parse(await readFile(path.join(process.cwd(), "data", "example", "rajshahi.json"), "utf8")) as Example;
  const noop = async () => {
    "use server";
    return READ_ONLY;
  };
  const noDraft = async () => {
    "use server";
    return { state: "unconfigured" as const };
  };
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader crumbs={[{ href: "/", label: "Home" }]} title={`Real example: ${ex.scenario.name}`} eyebrow={ex.place.name}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          <EvidenceChip evidenceClass="simulation_output" />
          <Typography variant="body2" color="text.secondary">
            Engine {ex.engineVersion} · built {ex.builtAt.slice(0, 10)}
          </Typography>
        </Stack>
      </PageHeader>
      <Alert severity="info" sx={{ mb: 3 }}>
        A real run, no account needed: live NASA POWER weather ({ex.result.period.fromYear}–{ex.result.period.toYear}) and the SoilGrids soil estimate for a test square at {ex.place.lat}, {ex.place.lon}, through the same engine every field uses. Only the farm history is invented: {ex.illustrativeHistory} Saving and re-running are switched off here.{" "}
        <ButtonLink href="/sign-up" size="small" variant="contained" sx={{ ml: { sm: 1 }, mt: { xs: 1, sm: 0 } }}>
          Try your own field
        </ButtonLink>
      </Alert>
      <ExampleGuide />
      <RunFixList result={ex.result} fieldId="example" scenarioId={null} />
      <RunExplorer
        runId="example"
        result={ex.result}
        plans={[]}
        geometry={ex.geometry}
        outdated={null}
        snapshotDate={ex.builtAt}
        scenarioId={null}
        aiAvailable={false}
        details={<RunResult result={ex.result} resultSha256={ex.resultSha256} inputDigest={ex.result.inputDigest ?? null} />}
        actions={{ save: noop, update: noop, remove: noop, deleteRun: noop, rerun: null, savePriorities: null, draft: noDraft }}
      />
      {(ex.water || ex.grace || ex.outlook) && (
        <Box component="section" aria-labelledby="ex-water" sx={{ mt: 5 }}>
          <Typography id="ex-water" variant="h5" component="h2" sx={{ mb: 1 }}>
            Water and pumping energy for these rotations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 820 }}>
            The same comparison carried into the Water & Energy planner: water each rotation needs from a tube well, pump power and energy, and the solar array that would cover it from NASA POWER sunshine. {ex.water?.note}
          </Typography>
          {ex.outlook?.status === "ok" && !ex.outlook.noDrySeason && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Weather-based dry season here: {MONTH[ex.outlook.dryMonths[0]! - 1]} → {MONTH[ex.outlook.dryMonths.at(-1)! - 1]} (rain below half of evaporation, NASA POWER {ex.outlook.period?.from.slice(0, 4)}–{ex.outlook.period?.to.slice(0, 4)}); ponds and small streams are most likely lowest in {ex.outlook.lowestMonth ? MONTH[ex.outlook.lowestMonth - 1] : "—"}. A climate indicator, not a measurement of any pond.
            </Alert>
          )}
          <GraceCard grace={ex.grace ?? null} />
          {ex.water && <ResultsView result={ex.water.result} input={ex.water.input} />}
        </Box>
      )}
    </Container>
  );
}
