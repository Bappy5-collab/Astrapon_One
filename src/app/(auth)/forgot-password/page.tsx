import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/AuthCard";
import { ActionForm, FormField } from "@/components/forms/ActionForm";
import { TextLink } from "@/components/links";
import { SetupRequired } from "@/components/SetupRequired";
import { getT } from "@/lib/i18n/server";
import { requestPasswordReset } from "@/server/auth/actions";
import { getAuth } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.auth.resetTitle") };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  const auth = await getAuth();
  if (auth.state === "unconfigured" || auth.state === "unreachable") return <SetupRequired feature="Password reset" reason={auth.state} />;
  return (
    <AuthCard title={t("app.auth.resetTitle")} intro={t("app.auth.resetIntro")} footer={<TextLink href="/sign-in">{t("app.auth.backToSignIn")}</TextLink>}>
      <ActionForm action={requestPasswordReset} submitLabel={t("app.auth.sendLink")}>
        <FormField name="email" label={t("app.auth.email")} type="email" autoComplete="email" required fullWidth />
      </ActionForm>
    </AuthCard>
  );
}
