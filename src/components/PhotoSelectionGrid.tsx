"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { MediaLightbox } from "@/components/MediaLightbox";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 9;

export function PhotoSelectionGrid({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const gestureRef = useRef<{ index: number; x: number; y: number; timer: number; longPressed: boolean } | null>(null);

  useEffect(() => () => {
    if (gestureRef.current) window.clearTimeout(gestureRef.current.timer);
  }, []);

  function selectOrSwap(index: number) {
    if (selected === null) {
      setSelected(index);
      setAnnouncement(`${index + 1}. fotoğraf seçildi. Yerini değiştirmek için başka bir fotoğrafa dokun.`);
      return;
    }
    if (selected === index) {
      setSelected(null);
      setAnnouncement("Fotoğraf seçimi kaldırıldı.");
      return;
    }
    const next = [...images];
    [next[selected], next[index]] = [next[index], next[selected]];
    onChange(next);
    setAnnouncement(`${selected + 1}. ve ${index + 1}. fotoğraf yer değiştirdi.`);
    setSelected(null);
  }

  function cancelGesture() {
    if (gestureRef.current) window.clearTimeout(gestureRef.current.timer);
    gestureRef.current = null;
  }

  function remove(index: number) {
    onChange(images.filter((_, imageIndex) => imageIndex !== index));
    setSelected((current) => current === index ? null : current !== null && current > index ? current - 1 : current);
    setAnnouncement(`${index + 1}. fotoğraf kaldırıldı.`);
  }

  if (!images.length) return null;
  return (
    <>
      <div className="upload-preview-grid" aria-label="Seçili fotoğraflar">
        {images.map((image, index) => (
          <div key={`${image.slice(-18)}-${index}`} className={selected === index ? "is-selected" : ""}>
            <button
              type="button"
              className="photo-order-button"
              aria-label={`${index + 1}. fotoğrafı sıralamak için seç`}
              aria-pressed={selected === index}
              onPointerDown={(event) => {
                cancelGesture();
                const gesture = { index, x: event.clientX, y: event.clientY, timer: 0, longPressed: false };
                gesture.timer = window.setTimeout(() => {
                  gesture.longPressed = true;
                  setPreview(index);
                }, LONG_PRESS_MS);
                gestureRef.current = gesture;
              }}
              onPointerMove={(event) => {
                const gesture = gestureRef.current;
                if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > MOVE_CANCEL_PX) cancelGesture();
              }}
              onPointerUp={() => {
                const gesture = gestureRef.current;
                if (!gesture) return;
                window.clearTimeout(gesture.timer);
                gestureRef.current = null;
                if (!gesture.longPressed) selectOrSwap(index);
              }}
              onPointerCancel={cancelGesture}
              onPointerLeave={(event) => { if (event.pointerType !== "mouse") return; cancelGesture(); }}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                selectOrSwap(index);
              }}
            >
              <Image src={image} alt={`Yüklenecek fotoğraf ${index + 1}`} fill unoptimized draggable={false} sizes="(max-width: 720px) 50vw, 190px" />
            </button>
            <button type="button" className="photo-remove-button" onClick={() => remove(index)} aria-label={`${index + 1}. fotoğrafı kaldır`}><X size={15} /></button>
            <button type="button" className="photo-preview-button" onClick={() => setPreview(index)} aria-label={`${index + 1}. fotoğrafı büyüt`}><Maximize2 size={14} /></button>
            <span>{index + 1}</span>
          </div>
        ))}
      </div>
      <p className="photo-order-help">Bir kez dokunup başka bir fotoğraf seçerek yerlerini değiştir. 0,5 saniye basılı tutarak büyüt.</p>
      <span className="visually-hidden" aria-live="polite">{announcement}</span>
      <MediaLightbox open={preview !== null} onClose={() => setPreview(null)} title={preview === null ? "Fotoğraf önizlemesi" : `${preview + 1}. fotoğraf önizlemesi`}>
        {preview === null ? null : <div className="lightbox-photo"><Image src={images[preview]} alt={`${preview + 1}. fotoğrafın büyütülmüş önizlemesi`} fill unoptimized sizes="96vw" priority /></div>}
      </MediaLightbox>
    </>
  );
}
