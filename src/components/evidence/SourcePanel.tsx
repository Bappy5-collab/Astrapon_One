"use client";

import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { isOptionalSource, SOURCE_LABELS, type PipelineSource } from "@/domain/evidence/catalog";
import type { SourceState } from "@/domain/evidence/view";
import { useFmt } from "@/components/replay/format";
import { useLivePoll } from "@/components/simulation/useLivePoll";
import { useT } from "@/lib/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { fmt } from "@/lib/i18n/sim-messages";
import { color, numeric, radius, tokens } from "@/theme/tokens";

import { EvidenceClassChip } from "./EvidenceInspector";
import { useEvidenceText } from "./text";

type Actions = {
  request: (sources: PipelineSource[]) => Promise<{ ok: boolean; message: string }>;
  cancel: (jobId: string) => Promise<{ ok: boolean; message: string }>;
};

const STATUS: Record<SourceState["status"], { bg: string; fg: string }> = {
  not_requested: { bg: tokens.neutral[200], fg: color.ink },
  queued: { bg: "#E5EEF6", fg: "#12344F" },
  running: { bg: "#E5EEF6", fg: "#12344F" },
  complete: { bg: tokens.lime[200], fg: tokens.forest[950] },
  failed: { bg: "#F6DED6", fg: "#6E2A1A" },
  stale: { bg: "#FBE7C6", fg: "#5A3A00" },
  not_applicable: { bg: tokens.neutral[200], fg: color.ink },
};

const ago = (iso: string, now: number, t: (k: MessageKey) => string, int: (n: number) => string) => {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  return m < 1 ? t("app.ev.justNow") : m < 60 ? fmt(t("app.ev.minAgo"), { n: int(m) }) : m < 48 * 60 ? fmt(t("app.ev.hAgo"), { n: int(Math.round(m / 60)) }) : fmt(t("app.ev.daysAgo"), { n: int(Math.round(m / 1440)) });
};

/** Per-source status with refresh / retry / cancel. Polls (by refreshing server data) while a job is active. */
export function SourcePanel({ sources, actions, compact = false, renderedAt }: { sources: SourceState[]; actions: Actions; compact?: boolean; renderedAt: number }) {
  const t = useT();
  const f = useFmt();
  const ev = useEvidenceText();
  const since = (iso: string) => ago(iso, renderedAt, t, f.int);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const isActive = (s: SourceState) => s.status === "queued" || s.status === "running";
  const active = sources.some(isActive);
  // "Refresh all" covers the required sources only; an optional source (MODIS) never blocks it.
  const required = sources.filter((s) => !isOptionalSource(s.source) && s.status !== "not_applicable");
  const requiredActive = required.some(isActive);

  useLivePoll(active);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      setMessage({ ok: r.ok, text: r.message });
      router.refresh();
    });

  const waitingForWorker = sources.some((s) => s.job?.status === "queued" && !s.job.started_at && renderedAt - Date.parse(s.job.created_at) > 45_000);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap", mb: 1.5 }}>
        <Typography variant="subtitle2" component="h3">
          {t("app.ev.sourcesTitle")}
        </Typography>
        <Button
          data-tour="refresh-all"
          size="small"
          variant="outlined"
          startIcon={<RefreshRoundedIcon />}
          disabled={pending || requiredActive || required.length === 0}
          onClick={() => run(() => actions.request(required.map((s) => s.source)))}
        >
          {t("app.ev.refreshAll")}
        </Button>
      </Stack>
      {waitingForWorker && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {t("app.ev.waitingWorker")} <code>pnpm evidence:worker</code>.
        </Alert>
      )}
      <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gap: 1 }}>
        {sources.map((s) => {
          const st = STATUS[s.status];
          const info = SOURCE_LABELS[s.source];
          const short = ev.sourceShort(s.source, info.short);
          const p = s.job?.progress as { step?: string; done?: number; total?: number } | undefined;
          return (
            <Box component="li" key={s.source} sx={{ p: 1.5, borderRadius: `${radius.md}px`, border: `1px solid ${color.line}`, bgcolor: color.surfaceRaised }} aria-busy={s.status === "running"}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {short}
                </Typography>
                <EvidenceClassChip value={info.evidenceClass} />
                <Chip size="small" label={t(`app.ev.status.${s.status}`)} sx={{ height: 22, bgcolor: st.bg, color: st.fg, fontWeight: 700 }} />
                {isOptionalSource(s.source) && <Chip size="small" variant="outlined" label={t("app.step.state.optional")} sx={{ height: 22 }} />}
              </Stack>
              {!compact && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                  {ev.sourcePlain(s.source, info.plain)}
                </Typography>
              )}
              {isOptionalSource(s.source) && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                  {t("app.ev.optionalNote")}
                </Typography>
              )}
              <Typography variant="caption" component="p" sx={{ mt: 0.5, ...numeric }}>
                {s.retrieval
                  ? `${fmt(t("app.ev.fetched"), { date: f.date(new Date(s.retrieval.retrieved_at).toISOString().slice(0, 10)), ago: since(s.retrieval.retrieved_at) })} · ${fmt(t("app.ev.observations"), { from: s.retrieval.observation_start ? f.date(s.retrieval.observation_start) : "—", to: s.retrieval.observation_end ? f.date(s.retrieval.observation_end) : "—" })}${s.stale ? ` · ${t("app.ev.olderThanInterval")}` : ""}`
                  : t("app.ev.noData")}
              </Typography>
              {(s.status === "queued" || s.status === "running") && (
                <Box sx={{ mt: 1 }}>
                  <LinearProgress
                    variant={p?.total ? "determinate" : "indeterminate"}
                    value={p?.total ? Math.round(((p.done ?? 0) / p.total) * 100) : undefined}
                    aria-label={fmt(t("app.ev.progress"), { source: short })}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                  <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, ...numeric }}>
                    {s.status === "queued" ? (s.job?.error_message ? `${t("app.ev.retryAfter")} ${s.job.error_message}` : t("app.ev.waiting")) : `${p?.step ?? t("app.ev.working")}${p?.total ? ` (${f.int(p.done ?? 0)}/${f.int(p.total)})` : ""}`}
                  </Typography>
                </Box>
              )}
              {(s.status === "failed" || (s.status === "stale" && s.job?.status === "failed")) && s.job?.error_message && (
                <Alert severity={s.retrieval ? "warning" : "error"} sx={{ mt: 1, py: 0 }}>
                  {t("app.ev.lastFailed")}{s.job.finished_at ? ` ${since(s.job.finished_at)}` : ""}: {s.job.error_message}
                  {s.retrieval ? ` ${t("app.ev.showingEarlier")}` : ""}
                </Alert>
              )}
              {s.status === "not_applicable" && s.job?.error_message && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                  {s.job.error_message}
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {s.status === "queued" || s.status === "running" ? (
                  <Button size="small" disabled={pending} onClick={() => run(() => actions.cancel(s.job!.id))}>
                    {t("ws.cancel")}
                  </Button>
                ) : s.status !== "not_applicable" ? (
                  <Button size="small" disabled={pending} onClick={() => run(() => actions.request([s.source]))}>
                    {s.status === "failed" ? t("app.ev.retry") : s.retrieval ? t("app.ev.refresh") : s.source === "modis-mod13q1-ornl" ? t("app.ev.fetchGreen") : s.source === "smap-l3-enhanced" ? t("app.ev.fetchSmap") : t("app.ev.fetch")}

                  </Button>
                ) : null}
              </Stack>
            </Box>
          );
        })}
      </Box>
      <Box aria-live="polite">{message && <Alert severity={message.ok ? "success" : "error"} sx={{ mt: 1.5 }} onClose={() => setMessage(null)}>{message.text}</Alert>}</Box>
    </Box>
  );
}
