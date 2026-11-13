import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthCard } from "@/components/auth/AuthCard";
import { ActionForm, FormField } from "@/components/forms/ActionForm";
import { TextLink } from "@/components/links";
import { SetupRequired } from "@/components/SetupRequired";
import { getT } from "@/lib/i18n/server";
import { signUp } from "@/server/auth/actions";
import { getAuth } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.auth.createTitle") };
}

export default async function SignUpPage() {
  const t = await getT();
  const auth = await getAuth();
  if (auth.state === "unconfigured" || auth.state === "unreachable") return <SetupRequired feature="Creating an account" reason={auth.state} />;
  if (auth.state === "signed_in") redirect("/farms");
  return (
    <AuthCard
      title={t("app.auth.createTitle")}
      intro={t("app.auth.createIntro")}
      footer={
        <span>
          {t("app.auth.haveAccount")} <TextLink href="/sign-in">{t("nav.signIn")}</TextLink>
        </span>
      }
    >
      <ActionForm action={signUp} submitLabel={t("app.auth.createTitle")}>
        <FormField name="email" label={t("app.auth.email")} type="email" autoComplete="email" required fullWidth />
        <FormField name="password" label={t("app.auth.password")} type="password" autoComplete="new-password" required fullWidth helperText={t("app.auth.passwordHelp")} />
        <FormField name="confirm" label={t("app.auth.confirm")} type="password" autoComplete="new-password" required fullWidth />
      </ActionForm>
    </AuthCard>
  );
}
