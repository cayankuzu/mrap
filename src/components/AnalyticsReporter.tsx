"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { reportAnalytics, toWebVitalAnalyticsEvent } from "@/lib/analytics";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

const handleWebVitals: ReportWebVitalsCallback = (metric) => {
  const event = toWebVitalAnalyticsEvent(metric);
  if (event) reportAnalytics(event);
};

export function AnalyticsReporter() {
  useReportWebVitals(handleWebVitals);
  useEffect(() => {
    document.documentElement.dataset.mrapHydrated = "true";
    return () => { delete document.documentElement.dataset.mrapHydrated; };
  }, []);
  return null;
}
