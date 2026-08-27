import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { notFound } from "next/navigation";
import { RealPostCard } from "@/components/RealFeed";
import { requireCurrentUser } from "@/lib/auth";
import { toFeedPlayerReference } from "@/lib/feed-player";
import { normalizePostResourceId } from "@/lib/post-resource";
import { getPostForViewer } from "@/lib/repository";

export const metadata: Metadata = { title: "Gönderi" };

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCurrentUser();
  const postId = normalizePostResourceId((await params).id);
  if (!postId) notFound();
  const post = await getPostForViewer(viewer.id, postId);
  if (!post) notFound();

  return (
    <div className="content-page post-detail-page">
      <header className="page-header post-detail-header">
        <div>
          <span className="eyebrow"><FileText size={13} /> Alan hikâyesi</span>
          <h1>Gönderi</h1>
          <p>Paylaşılan alanı, fotoğrafları ve topluluk hareketlerini tek yerde incele.</p>
        </div>
      </header>
      <RealPostCard post={post} currentUser={toFeedPlayerReference(viewer)} />
    </div>
  );
}
