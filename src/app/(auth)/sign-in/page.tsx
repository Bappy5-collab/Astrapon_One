import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/AuthCard";
import { ActionForm, FormField } from "@/components/forms/ActionForm";
import { TextLink } from "@/components/links";
import { SetupRequired } from "@/components/SetupRequired";
import { getT } from "@/lib/i18n/server";
import { signIn } from "@/server/auth/actions";
import { getAuth, safeNextPath } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("nav.signIn") };
}

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const t = await getT();
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const auth = await getAuth();
  if (auth.state === "unconfigured" || auth.state === "unreachable") return <SetupRequired feature="Signing in" reason={auth.state} />;
  if (auth.state === "signed_in") redirect(next);
  return (
    <AuthCard
      title={t("nav.signIn")}
      intro={t("app.auth.signInIntro")}
      footer={
        <Stack spacing={1}>
          <TextLink href="/forgot-password">{t("app.auth.forgot")}</TextLink>
          <span>
            {t("app.auth.newHere")} <TextLink href="/sign-up">{t("app.auth.createLink")}</TextLink>
          </span>
        </Stack>
      }
    >
      {params.signed_out === "1" && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("app.auth.signedOut")}
        </Alert>
      )}
      <ActionForm action={signIn} submitLabel={t("nav.signIn")}>
        <input type="hidden" name="next" value={next} />
        <FormField name="email" label={t("app.auth.email")} type="email" autoComplete="email" required fullWidth />
        <FormField name="password" label={t("app.auth.password")} type="password" autoComplete="current-password" required fullWidth />
      </ActionForm>
    </AuthCard>
  );
}
