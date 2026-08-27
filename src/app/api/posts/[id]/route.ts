import { getCurrentUser } from "@/lib/auth";
import { getPostForViewer } from "@/lib/repository";
import { noStoreJson } from "@/server/http/api-security";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const post = await getPostForViewer(user.id, (await params).id);
  return post ? noStoreJson({ post }) : noStoreJson({ error: "Gönderi bulunamadı." }, { status: 404 });
}
