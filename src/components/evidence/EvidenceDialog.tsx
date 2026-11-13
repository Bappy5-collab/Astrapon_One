"use client";

import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { ButtonLink } from "@/components/links";
import type { FieldEvidence } from "@/domain/evidence/view";
import type { BoundaryGeometry } from "@/domain/geo/boundary";
import { useT } from "@/lib/i18n/I18nProvider";

import { EvidenceDashboard, type EvidenceActions } from "./EvidenceDashboard";

/**
 * The field's weather and soil data over the steps page, opened right after the farmer saves their
 * priorities (`?evidence=1`), so the next step does not need a scroll back to the top. Closing it
 * drops the query; "Next" also scrolls to the comparison step.
 */
export function EvidenceDialog({
  fieldId,
  evidence,
  actions,
  boundary,
  zones,
  renderedAt,
}: {
  fieldId: string;
  evidence: FieldEvidence;
  actions: EvidenceActions;
  boundary: BoundaryGeometry;
  zones: { id: string; name: string; boundary: BoundaryGeometry }[];
  renderedAt: number;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const small = useMediaQuery((theme: Theme) => theme.breakpoints.down("md"));
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    router.replace(pathname, { scroll: false });
  };
  const toCompare = () => {
    close();
    // After the dialog has let go of the page scroll.
    setTimeout(() => document.getElementById("compare")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };
  return (
    <Dialog open={open} onClose={close} fullScreen={small} fullWidth maxWidth="lg" scroll="paper" aria-labelledby="evidence-dialog-title">
      <DialogTitle id="evidence-dialog-title" sx={{ pr: 7 }}>
        {t("app.rec.weatherSoil")}
        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: "block", mt: 0.5 }}>
          {t("app.ev.subtitle")}
        </Typography>
        <IconButton onClick={close} aria-label={t("app.evDialog.close")} sx={{ position: "absolute", right: 12, top: 12 }}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="success" sx={{ mb: 3 }}>
          {t("app.evDialog.saved")}
        </Alert>
        <EvidenceDashboard evidence={evidence} actions={actions} boundary={boundary} zones={zones} renderedAt={renderedAt} />
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        <ButtonLink href={`/fields/${fieldId}/evidence`}>{t("app.evDialog.fullPage")}</ButtonLink>
        <Button onClick={close}>{t("app.evDialog.close")}</Button>
        <Button variant="contained" onClick={toCompare}>
          {t("app.evDialog.next")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
