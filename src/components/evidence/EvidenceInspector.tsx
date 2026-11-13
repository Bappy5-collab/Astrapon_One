"use client";

import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";

import { INDICATORS, SOURCE_LABELS } from "@/domain/evidence/catalog";
import type { Metric, RetrievalMeta } from "@/domain/evidence/view";
import { EVIDENCE_CLASSES, type EvidenceClass } from "@/domain/provenance/evidence";
import { useFmt } from "@/components/replay/format";
import { useT } from "@/lib/i18n/I18nProvider";
import { fmt } from "@/lib/i18n/sim-messages";
import { color, numeric, radius, tokens } from "@/theme/tokens";

import { useEvidenceText } from "./text";

const CLASS_STYLE: Partial<Record<EvidenceClass, { bg: string; fg: string }>> = {
  satellite_observation: { bg: "#DCEBF5", fg: "#0F3B57" },
  assimilated_model_product: { bg: "#EFE6F6", fg: "#3E2257" },
  ground_measurement: { bg: "#E3EFDF", fg: "#1D3B1B" },
  farmer_report: { bg: tokens.lime[200], fg: tokens.forest[950] },
  hypothetical_input: { bg: "#FBE7C6", fg: "#5A3A00" },
  illustrative: { bg: tokens.neutral[200], fg: color.ink },
};

/** Consistent label for evidence classes everywhere evidence is shown. */
export function EvidenceClassChip({ value }: { value: EvidenceClass }) {
  const t = useT();
  const s = CLASS_STYLE[value] ?? { bg: tokens.neutral[200], fg: color.ink };
  const label = CLASS_STYLE[value] ? t(`app.evclass.${value}.short`) : t(`app.evclass.${value}.label`);
  return <Chip size="small" label={label} title={t(`app.evclass.${value}.meaning`)} sx={{ height: 22, bgcolor: s.bg, color: s.fg, fontWeight: 700 }} />;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <Box sx={{ display: "contents" }}>
      <Typography component="dt" variant="body2" color="text.secondary">
        {k}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: "anywhere", ...numeric }}>
        {v}
      </Typography>
    </Box>
  );
}

/**
 * The evidence inspector: plain facts first (what, when, where, how complete, limits), technical
 * provenance behind an expander (product and processing versions, retrieval id, hashes, request, checks).
 */
export function EvidenceInspector({ metric, retrieval, open, onClose }: { metric: Metric | null; retrieval: RetrievalMeta | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const f = useFmt();
  const ev = useEvidenceText();
  if (!metric) return null;
  const def = INDICATORS[metric.indicator];
  const label = ev.metricLabel(metric);
  const evClass = (EVIDENCE_CLASSES as readonly string[]).includes(retrieval?.evidence_class ?? "") ? t(`app.evclass.${retrieval!.evidence_class as EvidenceClass}.label`) : retrieval?.evidence_class;
  const src = SOURCE_LABELS[metric.source];
  const checks = retrieval?.checks ?? [];
  const failed = checks.filter((c) => !c.passed);
  const req = retrieval?.request ?? {};
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="inspector-title" fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle id="inspector-title" sx={{ pb: 1 }}>
        {label}
        <Box sx={{ mt: 0.75, display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <Typography component="span" sx={{ fontSize: "1.6rem", fontWeight: 700, ...numeric }}>
            {metric.display}
          </Typography>
          <EvidenceClassChip value={metric.evidenceClass} />
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {def && (
          <Typography variant="body1" sx={{ mb: 2 }}>
            {ev.plain(metric.indicator, def.plain)}
          </Typography>
        )}
        <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", columnGap: 2, rowGap: 1 }}>
          <Row k={t("app.ev.i.source")} v={src.name} />
          <Row k={t("app.ev.i.units")} v={metric.unit} />
          <Row k={t("app.ev.i.period")} v={metric.period} />
          {metric.comparison && <Row k={t("app.ev.i.compared")} v={metric.comparison} />}
          <Row k={t("app.ev.i.covers")} v={retrieval?.spatial_support ?? src.support} />
          <Row k={t("app.ev.i.completeness")} v={metric.completeness} />
          {retrieval && <Row k={t("app.ev.i.fetched")} v={`${f.date(new Date(retrieval.retrieved_at).toISOString().slice(0, 10))} ${f.digits(new Date(retrieval.retrieved_at).toISOString().slice(11, 16))} UTC`} />}
          {retrieval?.observation_start && <Row k={t("app.ev.i.observations")} v={fmt(t("app.ev.i.range"), { from: f.date(retrieval.observation_start), to: retrieval.observation_end ? f.date(retrieval.observation_end) : "—" })} />}
        </Box>
        {def && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" component="h3">
              {t("app.ev.i.limits")}
            </Typography>
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {def.limitations.map((l) => (
                <Typography component="li" variant="body2" key={l} sx={{ mb: 0.5 }}>
                  {l}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
        <Accordion disableGutters elevation={0} sx={{ mt: 2, border: `1px solid ${color.line}`, borderRadius: `${radius.md}px !important`, "&::before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
            <Typography variant="subtitle2">{t("app.ev.i.technical")}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            {def && (
              <>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t("app.ev.i.transformation")}
                </Typography>
                <Box component="ol" sx={{ m: 0, mt: 0.5, mb: 1.5, pl: 2.5 }}>
                  {def.transformation.map((s) => (
                    <Typography component="li" variant="body2" key={s}>
                      {s}
                    </Typography>
                  ))}
                </Box>
              </>
            )}
            {retrieval ? (
              <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", columnGap: 2, rowGap: 0.75, fontSize: "0.85rem" }}>
                <Row k={t("app.ev.i.product")} v={`${retrieval.product_id}${retrieval.product_version ? ` · ${fmt(t("app.ev.i.version"), { v: retrieval.product_version })}` : ""}`} />
                <Row k={t("app.ev.i.processing")} v={retrieval.processing_version ?? "—"} />
                <Row k={t("app.ev.i.class")} v={evClass} />
                <Row k={t("app.ev.i.retrievalId")} v={<code>{retrieval.id}</code>} />
                <Row k="Response SHA-256" v={<code>{retrieval.response_sha256}</code>} />
                <Row k={t("app.ev.i.size")} v={fmt(t("app.ev.i.sizeValue"), { kb: f.int(retrieval.response_bytes / 1024) })} />
                <Row k={t("app.ev.i.request")} v={<code style={{ fontSize: "0.78rem" }}>{JSON.stringify({ endpoint: req.endpoint, latitude: req.latitude, longitude: req.longitude, ...(req.kmAboveBelow !== undefined ? { kmAboveBelow: req.kmAboveBelow } : {}) })}</code>} />
                <Row k={t("app.ev.i.validation")} v={`${fmt(t("app.ev.i.checks"), { ok: f.int(checks.length - failed.length), n: f.int(checks.length) })}${failed.length ? `; ${t("app.ev.i.failed")} ${failed.slice(0, 6).map((c) => c.id).join(", ")}` : ""}`} />
                <Row k={t("app.ev.i.outcome")} v={retrieval.outcome} />
                {retrieval.cache_key && <Row k={t("app.ev.i.cacheKey")} v={<code>{retrieval.cache_key.slice(0, 16)}…</code>} />}
              </Box>
            ) : (
              <Typography variant="body2">{t("app.ev.i.noMeta")}</Typography>
            )}
          </AccordionDetails>
        </Accordion>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("app.ev.i.close")}</Button>

      </DialogActions>
    </Dialog>
  );
}
