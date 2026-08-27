import { getCurrentUser } from "@/lib/auth";
import { resolveFollowRequest } from "@/lib/repository";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, checkUserMutationRateLimit, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkUserMutationRateLimit(request, user.id, "follow-request-resolution", API_RATE_LIMITS.followRequestResolution);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.followRequestResolution);
    const action = body.action;
    if (action !== "accept" && action !== "reject") return noStoreJson({ error: "Geçersiz işlem." }, { status: 400 });
    const resolved = await resolveFollowRequest(user.id, (await params).id, action);
    return resolved ? noStoreJson({ ok: true }) : noStoreJson({ error: "Takip isteği bulunamadı." }, { status: 404 });
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
