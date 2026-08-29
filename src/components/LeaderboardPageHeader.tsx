"use client";

import { Trophy } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function LeaderboardPageHeader() {
  const { dictionary: copy } = useI18n();
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{copy.leaderboard.headerEyebrow}</span>
        <h1>{copy.leaderboard.headerTitle}</h1>
        <p>{copy.leaderboard.headerDescription}</p>
      </div>
      <span className="page-icon"><Trophy size={21} /></span>
    </header>
  );
}
