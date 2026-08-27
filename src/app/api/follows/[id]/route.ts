import { getCurrentUser } from "@/lib/auth";
import { setFollowState } from "@/lib/repository";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, checkUserMutationRateLimit, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkUserMutationRateLimit(request, user.id, "follow-toggle", API_RATE_LIMITS.followToggle);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.socialMutation);
    if (Object.keys(body).length !== 1 || typeof body.desired !== "boolean") return noStoreJson({ error: "Takip hedefi geçersiz." }, { status: 400 });
    const result = await setFollowState(user.id, (await params).id, body.desired);
    return result ? noStoreJson(result) : noStoreJson({ error: "Kullanıcı bulunamadı." }, { status: 404 });
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
