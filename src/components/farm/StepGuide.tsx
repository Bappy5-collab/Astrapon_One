"use client";

import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { ButtonLink, TextLink } from "@/components/links";
import { useFmt } from "@/components/replay/format";
import { nextStep, stepsDone, type FieldStep } from "@/domain/farm/progress";
import { useT } from "@/lib/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/sim-messages";
import { color, elevation, radius, tokens } from "@/theme/tokens";

import { stepText } from "./step-text";

/** Progress bar with "n of 6 done". */
export function StepProgress({ steps, dense = false }: { steps: FieldStep[]; dense?: boolean }) {
  const t = useT();
  const f = useFmt();
  const done = stepsDone(steps);
  const vars = { done: f.int(done), total: f.int(steps.length) };
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
      <LinearProgress
        variant="determinate"
        value={(done / steps.length) * 100}
        aria-label={fmt(t("app.step.progressAria"), vars)}
        sx={{ flexGrow: 1, height: dense ? 6 : 8, borderRadius: 4, bgcolor: tokens.neutral[200], "& .MuiLinearProgress-bar": { bgcolor: tokens.forest[500], borderRadius: 4 } }}
      />
      <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: "nowrap", color: color.inkMuted }}>
        {fmt(t("app.step.progress"), vars)}
      </Typography>
    </Stack>
  );
}

/**
 * The guided path for one field: what is done, the one next thing to do, and a link for every step.
 * Every step stays reachable, so the guide never locks the farmer out of a later step.
 */
export function StepGuide({ steps }: { steps: FieldStep[] }) {
  const t = useT();
  const f = useFmt();
  const next = nextStep(steps);
  const text = (s: FieldStep) => stepText(s, t, f.int);
  const nextText = next ? text(next) : null;
  const target = next ?? steps.at(-1);
  return (
    <Box component="section" aria-labelledby="steps-h" data-tour="steps" sx={{ mb: 3, borderRadius: `${radius.lg + 4}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised, boxShadow: elevation.raised, overflow: "hidden" }}>
      <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: tokens.forest[900], color: tokens.neutral[100] }}>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "center" }, justifyContent: "space-between" }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" component="p" sx={{ color: tokens.lime[400], fontWeight: 700, letterSpacing: "0.08em" }}>
              {next ? t("app.step.yourNext") : stepsDone(steps) === steps.length ? t("app.step.allDone") : t("app.step.resultsReady")}
            </Typography>
            <Typography id="steps-h" variant="h5" component="h2" sx={{ color: tokens.neutral[0], fontSize: { xs: "1.25rem", md: "1.45rem" } }}>
              {nextText ? nextText.title : t("app.step.resultsReadyTitle")}
            </Typography>
            <Typography variant="body2" sx={{ color: tokens.neutral[300], mt: 0.5, maxWidth: 620 }}>
              {nextText ? nextText.why : t("app.step.resultsReadyWhy")}
            </Typography>
          </Box>
          {target && (
            <ButtonLink
              href={target.href}
              variant="contained"
              endIcon={<ArrowForwardRoundedIcon />}
              sx={{ bgcolor: tokens.lime[400], color: tokens.forest[950], flexShrink: 0, px: 2.5, py: 1.1, fontSize: "1rem", "&:hover": { bgcolor: tokens.lime[300] } }}
            >
              {text(target).action}
            </ButtonLink>
          )}
        </Stack>
        <Box sx={{ mt: 2.5, "& .MuiTypography-root": { color: tokens.neutral[200] } }}>
          <StepProgress steps={steps} />
        </Box>
      </Box>
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: { xs: 1.5, md: 2 }, display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" } }}>
        {steps.map((s, i) => {
          const isNext = s.state === "next";
          const done = s.state === "done";
          const st = text(s);
          return (
            <Box
              component="li"
              key={s.id}
              aria-current={isNext ? "step" : undefined}
              sx={{
                p: 1.5,
                borderRadius: `${radius.md + 2}px`,
                border: `1px solid ${isNext ? tokens.forest[500] : color.line}`,
                bgcolor: isNext ? tokens.lime[200] : done ? color.surface : color.surfaceRaised,
                display: "flex",
                gap: 1.25,
                alignItems: "flex-start",
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  bgcolor: done ? tokens.forest[500] : isNext ? tokens.forest[900] : tokens.neutral[200],
                  color: done || isNext ? tokens.neutral[0] : color.inkMuted,
                }}
              >
                {done ? <CheckRoundedIcon sx={{ fontSize: 18 }} /> : i + 1}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, lineHeight: 1.3 }}>{st.title}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                  <Box component="span" sx={{ fontWeight: 600, color: done ? tokens.forest[600] : isNext ? tokens.forest[900] : color.inkSubtle }}>
                    {t(`app.step.state.${s.state}`)}
                  </Box>
                  {" · "}
                  {st.status}
                </Typography>
                <TextLink href={s.href} sx={{ display: "inline-block", mt: 0.5, fontWeight: 600, fontSize: "0.9rem" }}>
                  {st.action} →

                </TextLink>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
