"use client";

import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { usePathname } from "next/navigation";

import { TextLink } from "@/components/links";
import { useT } from "@/lib/i18n/I18nProvider";
import { tokens } from "@/theme/tokens";

/** Hidden on desktop in full-height workspaces (field workspace, sample, new field) so the 3D view fills the screen. */
const WORKSPACE = [/^\/fields\/[0-9a-f-]{36}$/i, /^\/sample$/, /^\/fields\/new$/];

export function SiteFooter() {
  const t = useT();
  const pathname = usePathname();
  const workspace = WORKSPACE.some((r) => r.test(pathname));
  return (
    <Box component="footer" sx={{ bgcolor: tokens.forest[950], color: tokens.neutral[200], py: 4, display: workspace ? { xs: "block", md: "none" } : "block" }}>
      <Container maxWidth="lg">
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2" sx={{ maxWidth: 680, color: tokens.neutral[300] }}>
            {t("app.footer.disclaimer")} {t("app.footer.attribution")}
          </Typography>
          <Stack spacing={0.5} sx={{ flexShrink: 0 }}>
            <Typography variant="body2" sx={{ color: tokens.neutral[300] }}>
              {t("app.footer.tagline")}
            </Typography>
            <Typography variant="body2">
              <TextLink href="/methodology" sx={{ color: tokens.lime[400] }}>
                {t("app.footer.methodology")}
              </TextLink>
              {" · "}
              <TextLink href="/sources" sx={{ color: tokens.lime[400] }}>
                {t("app.footer.sources")}
              </TextLink>
              {" · "}
              <TextLink href="/setup" sx={{ color: tokens.lime[400] }}>
                {t("app.footer.setup")}

              </TextLink>
            </Typography>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
