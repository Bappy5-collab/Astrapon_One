"use client";

import { useMemo } from "react";

import { useLocale } from "@/lib/i18n/I18nProvider";

import { waterFormatter } from "./format";

/** Water module formatting for the current language (client components). */
export function useWaterFmt() {
  const locale = useLocale();
  return useMemo(() => waterFormatter(locale), [locale]);
}
