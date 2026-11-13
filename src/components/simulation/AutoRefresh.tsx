"use client";

import { useLivePoll } from "./useLivePoll";

/** Keeps a server-rendered page current while something it is waiting for finishes in the background. */
export function AutoRefresh() {
  useLivePoll(true);
  return null;
}
