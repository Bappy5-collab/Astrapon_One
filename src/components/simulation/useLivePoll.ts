"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

/**
 * Refreshes the server-rendered page while `active`. The next refresh is scheduled only after the
 * previous one has finished: a new refresh cancels one still in flight, so a fixed timer shorter
 * than the page's render time would never show an update.
 */
export function useLivePoll(active: boolean, gapMs = 1000) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!active || pending) return;
    const timer = setTimeout(() => start(() => router.refresh()), gapMs);
    return () => clearTimeout(timer);
  }, [active, pending, gapMs, router]);
}
