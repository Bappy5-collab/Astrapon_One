"use client";

import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import Button from "@mui/material/Button";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { GuideKey } from "@/lib/i18n/guide-messages";
import { useT } from "@/lib/i18n/I18nProvider";
import { tokens } from "@/theme/tokens";

const Joyride = dynamic(() => import("react-joyride").then((m) => m.Joyride), { ssr: false });

type TourStep = { target: string; prefix: string };
type Tour = { id: string; match: RegExp; steps: TourStep[] };

const SEEN_PREFIX = "astrapon.tour.v1.";
const UUID = "[0-9a-f-]{36}";

/** One tour per page. Targets missing on screen (an empty list, a collapsed part) are left out when the tour starts. */
export const TOURS: Tour[] = [
  { id: "workspace", match: /^\/workspace$/, steps: [{ target: "[data-tour='fields']", prefix: "tour.ws.fields" }, { target: "[data-tour='add-field']", prefix: "tour.ws.add" }] },
  { id: "new-field", match: /^\/fields\/new$/, steps: [{ target: "[data-tour='field-search']", prefix: "tour.new.search" }, { target: "[data-tour='field-map']", prefix: "tour.new.map" }, { target: "[data-tour='field-details']", prefix: "tour.new.details" }] },
  {
    id: "records",
    match: new RegExp(`^/fields/${UUID}/records$`),
    steps: [
      { target: "[data-tour='steps']", prefix: "tour.rec.steps" },
      { target: "#history", prefix: "tour.rec.history" },
      { target: "#soil", prefix: "tour.rec.soil" },
      { target: "#water", prefix: "tour.rec.water" },
      { target: "#priorities", prefix: "tour.rec.priorities" },
      { target: "#compare", prefix: "tour.rec.compare" },
    ],
  },
  { id: "evidence", match: new RegExp(`^/fields/${UUID}/evidence$`), steps: [{ target: "[data-tour='refresh-all']", prefix: "tour.ev.refresh" }, { target: "[data-tour='evidence-cards']", prefix: "tour.ev.cards" }] },
  {
    id: "comparison",
    match: new RegExp(`^/scenarios/${UUID}$`),
    steps: [
      { target: "[data-tour='cmp-crops']", prefix: "tour.cmp.crops" },
      { target: "[data-tour='cmp-dates']", prefix: "tour.cmp.dates" },
      { target: "[data-tour='cmp-water']", prefix: "tour.cmp.water" },
      { target: "[data-tour='cmp-run']", prefix: "tour.cmp.run" },
      { target: "#results", prefix: "tour.cmp.results" },
    ],
  },
  { id: "result", match: new RegExp(`^/runs/${UUID}$`), steps: [{ target: "[data-tour='run-summary']", prefix: "tour.run.summary" }, { target: "[data-tour='run-tabs']", prefix: "tour.run.tabs" }] },
  { id: "water", match: new RegExp(`^/fields/${UUID}/water$`), steps: [{ target: "#water-source", prefix: "tour.water.source" }, { target: "#water-demand", prefix: "tour.water.demand" }, { target: "#water-pump", prefix: "tour.water.pump" }] },
];

const seen = (id: string) => {
  try {
    return window.localStorage.getItem(SEEN_PREFIX + id) === "1";
  } catch {
    return false;
  }
};
const markSeen = (id: string) => {
  try {
    window.localStorage.setItem(SEEN_PREFIX + id, "1");
  } catch {
    // Without storage the guide simply offers itself again.
  }
};

/** The "Guide" button in the header and the guided tour of the current page, shown once automatically. */
export function PageTour() {
  const t = useT();
  const pathname = usePathname();
  const tour = useMemo(() => TOURS.find((x) => x.match.test(pathname)) ?? null, [pathname]);
  const [active, setActive] = useState<{ path: string; targets: TourStep[]; attempt: number } | null>(null);

  const start = (targets: TourStep[]) => setActive((a) => ({ path: pathname, targets, attempt: (a?.attempt ?? 0) + 1 }));
  const present = () => tour?.steps.filter((s) => document.querySelector(s.target)) ?? [];

  useEffect(() => {
    if (!tour || seen(tour.id)) return;
    // A page can arrive well after its address changes, so keep looking for its parts for a while.
    // A page with nothing to point at does not spend its one automatic showing.
    let tries = 0;
    let foundOn = -1;
    const timer = setInterval(() => {
      tries += 1;
      const targets = tour.steps.filter((s) => document.querySelector(s.target));
      if (targets.length && foundOn < 0) foundOn = tries;
      // Two looks after the first part appears, so the rest of the page has rendered too.
      if (foundOn > 0 && tries >= foundOn + 2) {
        clearInterval(timer);
        setActive((a) => ({ path: pathname, targets, attempt: (a?.attempt ?? 0) + 1 }));
      } else if (tries >= 60) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [tour, pathname]);

  if (!tour) return null;
  const running = active?.path === pathname && active.targets.length > 0;
  const text = (s: TourStep, part: "title" | "body") => t(`${s.prefix}.${part}` as GuideKey);

  return (
    <>
      <Button
        size="small"
        startIcon={<HelpOutlineRoundedIcon />}
        aria-label={t("tour.buttonAria")}
        onClick={() => start(present())}
        sx={{ color: tokens.neutral[100], flexShrink: 0, minWidth: 0, "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 } } }}
      >
        <span className="tour-label">{t("tour.button")}</span>
      </Button>
      <style>{`@media (max-width: 599.95px) { .tour-label { display: none; } }`}</style>
      {running && (
        <Joyride
          key={active.attempt}
          run
          continuous
          steps={active.targets.map((s) => ({ target: s.target, title: text(s, "title"), content: text(s, "body"), placement: "auto" as const, skipBeacon: true, scrollOffset: 110 }))}
          options={{ primaryColor: tokens.forest[700], textColor: tokens.neutral[900], zIndex: 1400, showProgress: true, buttons: ["back", "skip", "primary"], overlayClickAction: false }}
          locale={{ back: t("tour.back"), close: t("tour.close"), last: t("tour.last"), next: t("tour.next"), skip: t("tour.skip") }}
          onEvent={(data) => {
            if (data.status === "finished" || data.status === "skipped") {
              markSeen(tour.id);
              setActive(null);
            }
          }}
        />
      )}
    </>
  );
}
