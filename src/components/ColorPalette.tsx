"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Palette } from "lucide-react";
import { COLOR_PALETTE_PAGES, readableTextColor } from "@/lib/app-config";

type ColorPaletteProps = {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  helper?: string;
  defaultExpanded?: boolean;
  className?: string;
};

export function ColorPalette({ value, onChange, label = "Renk paleti", helper, defaultExpanded = false, className = "" }: ColorPaletteProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const initialPage = Math.max(0, COLOR_PALETTE_PAGES.findIndex((page) => page.colors.some((color) => color === value)));
  const [page, setPage] = useState(initialPage);
  const trackRef = useRef<HTMLDivElement>(null);

  function goTo(nextPage: number) {
    const normalized = Math.max(0, Math.min(COLOR_PALETTE_PAGES.length - 1, nextPage));
    setPage(normalized);
    const track = trackRef.current;
    if (track) track.scrollTo({ left: track.clientWidth * normalized, behavior: "smooth" });
  }

  return (
    <section className={`color-palette-control${expanded ? " is-expanded" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="color-palette-summary" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <span className="selected-color-dot" style={{ "--selected-color": value, "--selected-color-text": readableTextColor(value) } as React.CSSProperties}><Palette size={15} /></span>
        <span><strong>{label}</strong>{helper ? <small>{helper}</small> : null}</span>
        <ChevronDown className="palette-chevron" size={17} />
      </button>
      {expanded ? (
        <div className="color-palette-body">
          <div className="color-palette-pagebar">
            <button type="button" onClick={() => goTo(page - 1)} disabled={page === 0} aria-label="Önceki renk grubu"><ChevronLeft size={17} /></button>
            <span><strong>{COLOR_PALETTE_PAGES[page].label}</strong><small>{page + 1} / {COLOR_PALETTE_PAGES.length}</small></span>
            <button type="button" onClick={() => goTo(page + 1)} disabled={page === COLOR_PALETTE_PAGES.length - 1} aria-label="Sonraki renk grubu"><ChevronRight size={17} /></button>
          </div>
          <div ref={trackRef} className="color-palette-track" onScroll={(event) => {
            const track = event.currentTarget;
            if (track.clientWidth) setPage(Math.round(track.scrollLeft / track.clientWidth));
          }}>
            {COLOR_PALETTE_PAGES.map((palettePage) => (
              <div className="color-palette-page" key={palettePage.id} aria-label={palettePage.label}>
                {palettePage.colors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={value === color ? "is-selected" : ""}
                    style={{ "--swatch": color, "--swatch-text": readableTextColor(color) } as React.CSSProperties}
                    onClick={() => onChange(color)}
                    aria-label={`${color} rengini seç`}
                    aria-pressed={value === color}
                  >
                    {value === color ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="color-palette-dots" aria-label="Renk grupları">
            {COLOR_PALETTE_PAGES.map((palettePage, index) => <button key={palettePage.id} type="button" className={page === index ? "is-active" : ""} onClick={() => goTo(index)} aria-label={`${palettePage.label} grubuna git`} aria-current={page === index ? "true" : undefined} />)}
          </div>
        </div>
      ) : null}
    </section>
  );
}
