import { destroySession, getCurrentUser } from "@/lib/auth";
import { noStoreJson } from "@/server/http/api-security";
import { authoritativeGameStore } from "@/server/game/store";

export async function POST() {
  const user = await getCurrentUser();
  if (user) {
    try {
      await authoritativeGameStore.revokeActiveSessionsForUser(user.id);
    } catch {
      return noStoreJson({ error: "Etkin rota güvenle kapatılamadı. Çıkış yapılmadı; lütfen yeniden dene." }, { status: 503 });
    }
  }
  await destroySession();
  return noStoreJson({ ok: true });
}
