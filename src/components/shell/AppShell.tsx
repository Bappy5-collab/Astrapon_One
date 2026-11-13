import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { getT } from "@/lib/i18n/server";

import { SiteFooter } from "./SiteFooter";
import { TopBar } from "./TopBar";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const t = await getT();
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <Link
        href="#main"
        sx={{
          position: "absolute",
          left: 8,
          top: -48,
          zIndex: 2000,
          p: 1,
          bgcolor: "secondary.main",
          color: "secondary.contrastText",
          borderRadius: 1,
          "&:focus": { top: 8 },
        }}
      >
        {t("app.shell.skip")}

      </Link>
      <TopBar />
      <Box component="main" id="main" sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </Box>
      <SiteFooter />
    </Box>
  );
}
