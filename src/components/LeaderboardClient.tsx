"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, CalendarRange, Crown, Flame, MapPin, Minus, Sparkles } from "lucide-react";
import { rankings } from "@/lib/data";
import { formatMessage } from "@/i18n/format";
import { useI18n } from "@/i18n/I18nProvider";

export function LeaderboardClient() {
  const { dictionary: copy } = useI18n();
  const scopes = [copy.leaderboard.friends, copy.leaderboard.neighborhood, copy.leaderboard.city, copy.leaderboard.country, copy.leaderboard.world];
  const [scope, setScope] = useState(copy.leaderboard.city);
  const [period, setPeriod] = useState(copy.leaderboard.thisWeek);
  const multiplier = scope === copy.leaderboard.world ? 2.8 : scope === copy.leaderboard.country ? 1.9 : scope === copy.leaderboard.neighborhood ? 0.72 : scope === copy.leaderboard.friends ? 0.54 : 1;
  const adjusted = rankings.map((entry) => ({ ...entry, area: entry.area * multiplier }));
  const podium = [adjusted[1], adjusted[0], adjusted[2]];

  return (
    <div className="leaderboard-view">
      <div className="leaderboard-filterbar">
        <div className="scope-tabs" role="tablist" aria-label={copy.leaderboard.scopeAria}>
          {scopes.map((item) => <button key={item} type="button" role="tab" aria-selected={scope === item} className={scope === item ? "is-active" : ""} onClick={() => setScope(item)}>{item}</button>)}
        </div>
        <label className="leaderboard-period"><CalendarRange size={17} /><span>{copy.leaderboard.period}</span><select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label={copy.leaderboard.periodAria}><option>{copy.leaderboard.thisWeek}</option><option>{copy.leaderboard.thisMonth}</option><option>{copy.leaderboard.wholeSeason}</option></select></label>
      </div>

      <div className="leaderboard-hero">
        <div className="leaderboard-heading">
          <span className="eyebrow"><Flame size={14} fill="currentColor" /> {copy.leaderboard.season}</span>
          <h2>{formatMessage(copy.leaderboard.leaders, { scope })}</h2>
          <p>{copy.leaderboard.heroHint}</p>
        </div>
        <div className="podium">
          {podium.map((entry, index) => {
            const place = index === 1 ? 1 : index === 0 ? 2 : 3;
            return (
              <div key={entry.handle} className={`podium-place podium-place--${place}`}>
                {place === 1 ? <Crown className="podium-crown" size={27} fill="currentColor" /> : null}
                <Link href={`/demo/users/${entry.handle}`} className="podium-avatar" style={{ "--rank-color": entry.color } as React.CSSProperties}>{entry.initials}<i>{place}</i></Link>
                <Link href={`/demo/users/${entry.handle}`}><strong>{entry.name}</strong></Link>
                <span>{entry.area.toFixed(1).replace(".", ",")} km²</span>
                <div className="podium-block" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="ranking-table-card">
        <div className="ranking-table-header"><span>{copy.leaderboard.rank}</span><span>{copy.leaderboard.player}</span><span>{copy.common.city}</span><span>{copy.leaderboard.area}</span></div>
        {adjusted.slice(3).map((entry) => (
          <div className="ranking-row" key={entry.handle}>
            <div className="rank-number">{entry.rank}</div>
            <Link href={`/demo/users/${entry.handle}`} className="rank-user"><span className="avatar avatar--sm" style={{ "--avatar-color": entry.color } as React.CSSProperties}>{entry.initials}</span><span><strong>{entry.name}</strong><small>@{entry.handle}</small></span></Link>
            <div className="rank-city"><MapPin size={14} /> {entry.city}</div>
            <div className="rank-score"><strong>{entry.area.toFixed(1).replace(".", ",")} km²</strong><span className={entry.change > 0 ? "is-up" : entry.change < 0 ? "is-down" : ""}>{entry.change > 0 ? <ArrowUp size={13} /> : entry.change < 0 ? <ArrowDown size={13} /> : <Minus size={13} />}{Math.abs(entry.change)}</span></div>
          </div>
        ))}
        <div className="your-rank-row">
          <span className="rank-number">24</span>
          <Link href="/demo/profile" className="avatar avatar--sm" style={{ "--avatar-color": "#bdf565" } as React.CSSProperties}>CA</Link>
          <Link href="/demo/profile"><strong>{copy.leaderboard.you}</strong><small>İlk %8 içindesin</small></Link>
          <span><Sparkles size={14} /> 12,8 km²</span>
        </div>
      </div>
    </div>
  );
}
