"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MediaLightbox } from "@/components/MediaLightbox";

export type CarouselItem = { id: string; src?: string; variant?: string; alt: string };

export function PostMediaCarousel({ items, compact = false }: { items: CarouselItem[]; compact?: boolean }) {
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  if (!items.length) return null;

  function movePreview(direction: -1 | 1) {
    setPreview((current) => current === null ? null : Math.max(0, Math.min(items.length - 1, current + direction)));
  }

  function finishSwipe(event: React.PointerEvent<HTMLDivElement>) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    movePreview(deltaX < 0 ? 1 : -1);
  }

  const selectedItem = preview === null ? null : items[preview];

  return (
    <section className={`post-media-gallery${compact ? " is-compact" : ""}`} aria-label={`${items.length} fotoğraflı galeri`}>
      <ul className="post-media-strip" aria-label="Fotoğrafları sağa veya sola kaydır">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className={`post-media-thumb${item.variant ? ` post-photo post-photo--${item.variant}` : ""}`}
              aria-label={`${index + 1}. fotoğrafı büyüt: ${item.alt}`}
              onClick={() => setPreview(index)}
            >
              {item.src ? <Image src={item.src} alt="" fill unoptimized sizes="96px" /> : null}
            </button>
          </li>
        ))}
      </ul>

      <MediaLightbox open={preview !== null} onClose={() => setPreview(null)} title={preview === null ? "Fotoğraf" : `Fotoğraf ${preview + 1}/${items.length}`}>
        {selectedItem ? (
          <div className="lightbox-gallery">
            <div
              className="lightbox-photo-swipe-surface"
              onPointerDown={(event) => {
                swipeStartRef.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={finishSwipe}
              onPointerCancel={() => { swipeStartRef.current = null; }}
              aria-label="Fotoğraflar arasında kaydır"
            >
              <div className={`lightbox-photo${selectedItem.variant ? ` post-photo post-photo--${selectedItem.variant}` : ""}`}>
                {selectedItem.src ? <Image src={selectedItem.src} alt={selectedItem.alt} fill unoptimized sizes="96vw" priority /> : <span className="visually-hidden">{selectedItem.alt}</span>}
              </div>
            </div>
            {items.length > 1 ? (
              <>
                <button type="button" className="lightbox-gallery-arrow is-left" onClick={() => movePreview(-1)} disabled={preview === 0} aria-label="Önceki fotoğraf"><ChevronLeft size={24} /></button>
                <button type="button" className="lightbox-gallery-arrow is-right" onClick={() => movePreview(1)} disabled={preview === items.length - 1} aria-label="Sonraki fotoğraf"><ChevronRight size={24} /></button>
              </>
            ) : null}
          </div>
        ) : null}
      </MediaLightbox>
    </section>
  );
}
