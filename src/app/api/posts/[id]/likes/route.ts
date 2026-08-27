import { getCurrentUser } from "@/lib/auth";
import { listPostLikers } from "@/lib/repository";
import { noStoreJson } from "@/server/http/api-security";
import { checkRateLimit } from "@/server/http/rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await checkRateLimit(request, "post-likes-list", 120, 60 * 60 * 1000);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const result = await listPostLikers(user.id, (await params).id);
  return result
    ? noStoreJson(result)
    : noStoreJson({ error: "Gönderi bulunamadı." }, { status: 404 });
}
