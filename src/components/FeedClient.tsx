"use client";

import dynamic from "next/dynamic";
import { ChangeEvent, FormEvent, useRef, useState } from "react";
import { ImagePlus, MapPin, Plus, Send, Sparkles, X } from "lucide-react";
import { PhotoSelectionGrid } from "@/components/PhotoSelectionGrid";
import { PostCard } from "@/components/PostCard";
import { optimizeImage } from "@/lib/client-image";
import { CONTENT_LIMITS, MEDIA_LIMITS } from "@/lib/content-limits";
import type { MapCameraState } from "@/lib/map-preview";
import { useModalDialog } from "@/lib/use-modal-dialog";
import type { Post, Territory } from "@/lib/data";

const TerritoryFrameEditor = dynamic(() => import("@/components/TerritoryFrameEditor").then((module) => module.TerritoryFrameEditor), { ssr: false, loading: () => <div className="empty-snapshot"><span>Harita kadrajı hazırlanıyor…</span></div> });

const availableTerritories: Territory[] = [
  { id: "yeldegirmeni", name: "Yeldeğirmeni Sabah Turu", district: "Kadıköy, İstanbul", area: "0,36 km²", distance: "3,2 km", duration: "31 dk", color: "#bdf565", variant: 3 },
  { id: "fenerbahce", name: "Fenerbahçe Park Döngüsü", district: "Kadıköy, İstanbul", area: "0,62 km²", distance: "4,1 km", duration: "38 dk", color: "#bdf565", variant: 1 },
  { id: "uskudar", name: "Üsküdar Meydan Hattı", district: "Üsküdar, İstanbul", area: "0,28 km²", distance: "2,8 km", duration: "27 dk", color: "#bdf565", variant: 2 },
];

export function FeedClient({ initialPosts }: { initialPosts: Post[] }) {
  const [posts, setPosts] = useState(initialPosts);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [mapSnapshot, setMapSnapshot] = useState("");
  const [mapView, setMapView] = useState<MapCameraState | null>(null);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerDialogRef = useRef<HTMLElement>(null);
  const selectedTerritory = availableTerritories.find((territory) => territory.id === territoryId);

  useModalDialog(composerOpen, () => setComposerOpen(false), composerDialogRef);

  async function handlePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (photoPreviews.length + files.length > MEDIA_LIMITS.postImages.maxCount) { setError(`Bir paylaşımda en fazla ${MEDIA_LIMITS.postImages.maxCount} fotoğraf olabilir.`); return; }
    try {
      const loaded = await Promise.all(files.map((file) => optimizeImage(file)));
      setPhotoPreviews((current) => [...current, ...loaded].slice(0, MEDIA_LIMITS.postImages.maxCount));
      setError("");
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "Fotoğraflar işlenemedi.");
    }
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTerritory || !mapSnapshot || !mapView || title.trim().length < CONTENT_LIMITS.postTitle.min) return;
    const newPost: Post = {
      id: `local-${Date.now()}`,
      user: { name: "Cayan Akın", handle: "cayan", initials: "CA", color: "#bdf565" },
      time: "şimdi",
      title: title.trim(),
      text: text.trim(),
      territory: selectedTerritory,
      likes: 0,
      comments: 0,
      imageSources: photoPreviews,
      mapSnapshot,
      mapView,
    };
    setPosts((current) => [newPost, ...current]);
    setTitle("");
    setText("");
    setTerritoryId("");
    setMapSnapshot("");
    setMapView(null);
    setPhotoPreviews([]);
    setComposerOpen(false);
    setPublished(true);
    window.setTimeout(() => setPublished(false), 2600);
  }

  return (
    <>
      <button type="button" className="composer-launcher" onClick={() => setComposerOpen(true)}>
        <span className="avatar avatar--md" style={{ "--avatar-color": "#bdf565" } as React.CSSProperties}>CA</span>
        <span>Alanını ölümsüzleştir…</span>
        <span className="composer-add"><Plus size={20} /></span>
      </button>

      {published ? <div className="toast"><Sparkles size={18} /> Alanın akışında ölümsüzleşti.</div> : null}

      <div className="feed-list adaptive-post-flow">
        {posts.map((post) => <PostCard key={post.id} post={post} />)}
      </div>

      {composerOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setComposerOpen(false);
        }}>
          <section ref={composerDialogRef} className="composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title" tabIndex={-1}>
            <header className="modal-header">
              <div>
                <span className="eyebrow">Yeni paylaşım</span>
                <h2 id="composer-title">Alanını ölümsüzleştir</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setComposerOpen(false)} aria-label="Pencereyi kapat"><X size={21} /></button>
            </header>

            {error ? <div className="form-error" role="alert">{error}</div> : null}

            <form onSubmit={publish}>
              <label className="composer-text-field"><span>Başlık <small>{title.length}/{CONTENT_LIMITS.postTitle.max}</small></span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Rotana kısa bir başlık ver" minLength={CONTENT_LIMITS.postTitle.min} maxLength={CONTENT_LIMITS.postTitle.max} required autoFocus /></label>
              <label className="composer-text-field"><span>Açıklama <small>{text.length}/{CONTENT_LIMITS.postBody.max}</small></span><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Bu alanın hikâyesini anlat…" maxLength={CONTENT_LIMITS.postBody.max} /></label>
              <div className="field-block">
                <label htmlFor="territory-select"><MapPin size={17} /> İlgili alan <strong>Zorunlu</strong></label>
                <select id="territory-select" value={territoryId} onChange={(event) => { setTerritoryId(event.target.value); setMapSnapshot(""); setMapView(null); }} required>
                  <option value="">Kapladığın alanı seç</option>
                  {availableTerritories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name} · {territory.area}</option>)}
                </select>
              </div>

              {selectedTerritory ? (
                <div className="composer-map-preview">
                  <TerritoryFrameEditor key={selectedTerritory.id} territory={selectedTerritory} ownerUsername="cayan" onSave={(snapshot, view) => { setMapSnapshot(snapshot); setMapView(view); }} />
                </div>
              ) : (
                <div className="empty-snapshot"><MapPin size={24} /><span>İlgili alanı seç; paylaşılacak harita kadrajını ayarla.</span></div>
              )}

              <PhotoSelectionGrid images={photoPreviews} onChange={setPhotoPreviews} />

              <div className="composer-footer">
                <div>
                  <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handlePhotos} id="photo-upload" tabIndex={-1} />
                  <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={photoPreviews.length >= MEDIA_LIMITS.postImages.maxCount}><ImagePlus size={18} /> Fotoğraf ekle <small>{photoPreviews.length}/{MEDIA_LIMITS.postImages.maxCount}</small></button>
                </div>
                <button type="submit" className="primary-button" disabled={!selectedTerritory || !mapSnapshot || !mapView || title.trim().length < CONTENT_LIMITS.postTitle.min}><Send size={18} /> Paylaş</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
