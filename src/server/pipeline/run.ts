import type { PipelineSource } from "@/domain/evidence/catalog";

import { runImerg } from "./imerg";
import { runModis } from "./modis";
import { runPower } from "./power";
import { runSsurgo } from "./ssurgo";
import { runSmap } from "./smap";
import { runSoilGrids } from "./soilgrids";
import type { FieldContext, PipelineOutput, Progress } from "./types";

export const RUNNERS: Record<PipelineSource, (ctx: FieldContext, progress: Progress) => Promise<PipelineOutput>> = {
  "nasa-power-daily": (ctx, p) => runPower(ctx, p),
  "gpm-imerg-daily": (ctx, p) => runImerg(ctx, p),
  "modis-mod13q1-ornl": (ctx, p) => runModis(ctx, p),
  "usda-ssurgo-sda": (ctx, p) => runSsurgo(ctx, p),
  "isric-soilgrids-v2": (ctx, p) => runSoilGrids(ctx, p),
  "smap-l3-enhanced": (ctx, p) => runSmap(ctx, p),
};
