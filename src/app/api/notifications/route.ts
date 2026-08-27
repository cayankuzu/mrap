import { getCurrentUser } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/repository";
import { API_RATE_LIMITS, checkUserMutationRateLimit, noStoreJson } from "@/server/http/api-security";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  return noStoreJson({ notifications: await listNotifications(user.id) });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkUserMutationRateLimit(request, user.id, "notification-read", API_RATE_LIMITS.notificationRead);
  if (limited) return limited;
  await markNotificationsRead(user.id);
  return noStoreJson({ ok: true });
}
