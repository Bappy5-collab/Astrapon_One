import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EvidenceDashboard } from "@/components/evidence/EvidenceDashboard";
import { PageHeader } from "@/components/farm/ui";
import { ButtonLink } from "@/components/links";
import { SetupRequired } from "@/components/SetupRequired";
import type { PipelineSource } from "@/domain/evidence/catalog";
import { getT } from "@/lib/i18n/server";
import { requireUser } from "@/server/auth/session";
import { cancelEvidenceJob, requestEvidence } from "@/server/evidence/actions";
import { getFieldEvidence } from "@/server/evidence/queries";
import { getField } from "@/server/farm/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.ev.title") };
}

export default async function FieldEvidencePage({ params }: PageProps<"/fields/[fieldId]/evidence">) {
  const t = await getT();
  const { fieldId } = await params;
  const user = await requireUser(`/fields/${fieldId}/evidence`);
  if (user.state !== "signed_in") return <SetupRequired feature="Field evidence" reason={user.state} />;
  if (!/^[0-9a-f-]{36}$/i.test(fieldId)) notFound();
  const field = await getField(user.supabase, fieldId);
  if (!field) notFound();
  if (!field.geometry.boundary)
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <PageHeader crumbs={[{ href: "/workspace", label: t("app.ws.title") }, { href: `/fields/${fieldId}/records`, label: field.name }]} title={t("app.ev.title")} />
        <Typography>{t("app.ev.drawFirst")}</Typography>
        <ButtonLink href={`/fields/${fieldId}`} variant="contained" sx={{ mt: 2 }}>
          {t("app.step.action.draw")}
        </ButtonLink>
      </Container>
    );
  const evidence = await getFieldEvidence(user.supabase, fieldId);
  const request = async (sources: PipelineSource[]) => {
    "use server";
    return requestEvidence(fieldId, sources);
  };
  const cancel = async (jobId: string) => {
    "use server";
    return cancelEvidenceJob(fieldId, jobId);
  };
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
      <PageHeader
        crumbs={[{ href: "/workspace", label: t("app.ws.title") }, { href: `/fields/${fieldId}/records`, label: field.name }]}
        title={t("app.ev.title")}
        eyebrow={field.name}
        subtitle={t("app.ev.subtitle")}
        actions={
          <ButtonLink href={`/fields/${fieldId}/records`} variant="outlined">
            {t("app.ev.back")}

          </ButtonLink>
        }
      />
      <EvidenceDashboard
        evidence={evidence}
        actions={{ request, cancel }}
        boundary={field.geometry.boundary}
        zones={field.geometry.zones}
        // eslint-disable-next-line react-hooks/purity
        renderedAt={Date.now()}
      />
    </Container>
  );
}
