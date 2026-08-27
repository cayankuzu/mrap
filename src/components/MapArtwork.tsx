import type { Territory } from "@/lib/data";

type MapArtworkProps = {
  territory?: Territory;
  live?: boolean;
  className?: string;
};

const territoryShapes: Record<1 | 2 | 3 | 4, string> = {
  1: "180,430 215,336 310,300 362,215 455,186 535,248 570,342 510,414 392,438 288,410",
  2: "165,335 236,260 320,278 362,185 454,160 534,215 596,305 560,398 468,424 386,380 290,420 212,398",
  3: "230,420 190,350 245,280 338,294 402,220 490,245 540,330 502,408 410,386 330,440",
  4: "134,382 170,282 270,238 342,174 446,205 510,158 610,222 646,330 580,412 466,386 370,440 264,400",
};

export function MapArtwork({ territory, live = false, className = "" }: MapArtworkProps) {
  const color = territory?.color ?? "#bdf565";
  const shape = territoryShapes[territory?.variant ?? 1];

  return (
    <svg
      className={`map-artwork ${className}`}
      viewBox="0 0 760 560"
      role="img"
      aria-label={territory ? `${territory.name} alan haritası` : "Canlı şehir haritası"}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="760" height="560" fill="#e7eadf" />
      <path d="M0 82 C126 22 218 96 348 55 S615 72 760 20" fill="none" stroke="#d5d9cf" strokeWidth="22" />
      <path d="M-40 470 C155 376 230 490 390 392 S628 344 810 402" fill="none" stroke="#d2d7cc" strokeWidth="30" />
      <path d="M91 -30 C128 126 94 216 188 316 S240 490 206 610" fill="none" stroke="#f7f8f3" strokeWidth="14" />
      <path d="M402 -30 C370 110 438 194 396 310 S430 478 520 594" fill="none" stroke="#f7f8f3" strokeWidth="18" />
      <path d="M690 -20 C598 96 632 188 580 270 S600 446 704 590" fill="none" stroke="#f7f8f3" strokeWidth="12" />
      <path d="M-30 158 C105 196 215 138 330 176 S576 154 790 218" fill="none" stroke="#f7f8f3" strokeWidth="16" />
      <path d="M-20 326 C114 290 254 356 362 306 S608 294 792 310" fill="none" stroke="#f7f8f3" strokeWidth="12" />
      <g fill="none" stroke="#cdd2c8" strokeWidth="2" opacity="0.9">
        <path d="M22 220 L98 240 L124 310 L70 352 L12 330 Z" />
        <path d="M246 28 L324 44 L338 112 L278 146 L218 104 Z" />
        <path d="M486 38 L566 24 L610 82 L566 132 L478 112 Z" />
        <path d="M602 416 L690 398 L736 458 L704 528 L622 516 Z" />
        <path d="M288 462 L360 438 L416 486 L394 548 L304 542 Z" />
      </g>
      <polygon points={shape} fill={color} opacity="0.52" stroke={color} strokeWidth="6" strokeLinejoin="round" />
      <polyline
        points={live ? "224,407 254,362 302,344 334,290 376,270 402,232 452,218 490,244" : shape}
        fill="none"
        stroke={live ? "#15221b" : color}
        strokeWidth={live ? 7 : 3}
        strokeDasharray={live ? "1 14" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="#aab2a5">
        <circle cx="93" cy="112" r="5" />
        <circle cx="646" cy="162" r="5" />
        <circle cx="110" cy="458" r="5" />
        <circle cx="622" cy="366" r="5" />
      </g>
      <g transform="translate(490 244)">
        <circle r="18" fill="#fff" opacity="0.9" />
        <circle r="9" fill={live ? "#15221b" : color} />
        {live ? <circle r="28" fill="none" stroke="#15221b" opacity="0.2" strokeWidth="3" /> : null}
      </g>
      <g fontFamily="Arial, sans-serif" fontSize="13" fontWeight="700" fill="#7b8579" letterSpacing="1">
        <text x="62" y="187">SAHİL YOLU</text>
        <text x="505" y="354">PARK</text>
        <text x="276" y="128">MERKEZ</text>
      </g>
    </svg>
  );
}
