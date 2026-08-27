"use client";

import { useId } from "react";

const OWNER_PATHS: Record<number, { upper: string; lower: string }> = {
  1: {
    upper: "M 195 398 L 224 330 L 312 294 L 370 224 L 455 196 L 526 252",
    lower: "M 202 414 L 294 426 L 392 448 L 500 420 L 556 350",
  },
  2: {
    upper: "M 180 324 L 242 268 L 318 284 L 366 198 L 452 170 L 526 220",
    lower: "M 182 366 L 284 410 L 382 390 L 468 430 L 554 390",
  },
  3: {
    upper: "M 204 350 L 252 292 L 336 302 L 402 232 L 486 252 L 528 324",
    lower: "M 224 406 L 326 432 L 410 394 L 496 402",
  },
  4: {
    upper: "M 154 366 L 184 290 L 276 246 L 346 188 L 442 214 L 510 170 L 598 224",
    lower: "M 158 390 L 262 410 L 370 448 L 470 394 L 568 418 L 628 334",
  },
};

type TerritoryOwnerPathProps = {
  username: string;
  variant?: number;
};

export function TerritoryOwnerPath({ username, variant = 1 }: TerritoryOwnerPathProps) {
  const id = useId().replace(/:/g, "");
  const paths = OWNER_PATHS[variant] ?? OWNER_PATHS[1];
  const repeatedName = Array.from({ length: 8 }, () => `@${username}`).join("  ·  ");

  return (
    <svg className="territory-owner-path" viewBox="0 0 760 560" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Alan sahibi @${username}`}>
      <defs>
        <path id={`${id}-upper`} d={paths.upper} />
        <path id={`${id}-lower`} d={paths.lower} />
      </defs>
      <text><textPath href={`#${id}-upper`} startOffset="0">{repeatedName}</textPath></text>
      <text><textPath href={`#${id}-lower`} startOffset="0">{repeatedName}</textPath></text>
    </svg>
  );
}
