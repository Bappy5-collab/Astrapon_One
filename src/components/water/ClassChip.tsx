"use client";

import Chip from "@mui/material/Chip";

import { useT } from "@/lib/i18n/I18nProvider";
import { tokens } from "@/theme/tokens";

export type WaterClass = "observed" | "mapped" | "modelled" | "farmer" | "hypothetical" | "unavailable" | "assumption";

const STYLE: Record<WaterClass, { bg: string; fg: string }> = {
  observed: { bg: "#DDEBF6", fg: "#18476B" },
  mapped: { bg: "#E1EEF1", fg: "#1E5560" },
  modelled: { bg: tokens.lime[200], fg: tokens.forest[900] },
  farmer: { bg: "#F1E7D6", fg: "#5C4320" },
  hypothetical: { bg: "#EFE3F3", fg: "#5A2E6B" },
  assumption: { bg: tokens.neutral[200], fg: tokens.neutral[800] },
  unavailable: { bg: "#F6DED6", fg: tokens.clay },
};

/** Evidence-class chip for the water module (observed, mapped, modelled, farmer, hypothetical, unavailable). */
export function ClassChip({ kind }: { kind: WaterClass }) {
  const t = useT();
  const s = STYLE[kind];
  return <Chip size="small" label={t(`app.water.class.${kind}`)} sx={{ height: 22, fontWeight: 700, bgcolor: s.bg, color: s.fg }} />;
}
