import { getCurrentUser } from "@/lib/auth";
import { setSaveState } from "@/lib/repository";
import { API_BODY_BYTE_LIMITS, API_RATE_LIMITS, checkUserMutationRateLimit, noStoreJson, requestBodyErrorResponse } from "@/server/http/api-security";
import { readLimitedJsonObject } from "@/server/http/limited-json";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });
  const limited = await checkUserMutationRateLimit(request, user.id, "post-save", API_RATE_LIMITS.postSave);
  if (limited) return limited;
  try {
    const body = await readLimitedJsonObject(request, API_BODY_BYTE_LIMITS.socialMutation);
    if (Object.keys(body).length !== 1 || typeof body.desired !== "boolean") return noStoreJson({ error: "Kaydetme hedefi geçersiz." }, { status: 400 });
    const result = await setSaveState(user.id, (await params).id, body.desired);
    return result ? noStoreJson(result) : noStoreJson({ error: "Gönderi bulunamadı." }, { status: 404 });
  } catch (error) {
    const response = requestBodyErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
