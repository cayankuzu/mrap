import { destroySession, getCurrentUser, verifyCurrentUserPassword } from "@/lib/auth";
import { isAccountDeletionConfirmed, readAccountDeletionBody } from "@/lib/account-deletion-request";
import { deleteUserAccount } from "@/lib/repository";
import { noStoreJson } from "@/server/http/api-security";
import { checkRateLimit } from "@/server/http/rate-limit";

function configuredRateLimit() {
  const parsed = Number.parseInt(process.env.MRAP_ACCOUNT_DELETE_RATE_LIMIT ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 5;
}

function configuredRateWindowMs() {
  const parsed = Number.parseInt(process.env.MRAP_ACCOUNT_DELETE_RATE_WINDOW_MS ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 60_000 && parsed <= 86_400_000 ? parsed : 60 * 60 * 1000;
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return noStoreJson({ error: "Yetkisiz." }, { status: 401 });

  const limited = await checkRateLimit(request, `account-delete:${user.id}`, configuredRateLimit(), configuredRateWindowMs());
  if (limited) return limited;

  const body = await readAccountDeletionBody(request);
  if (!body.ok) {
    const status = body.reason === "too_large" ? 413 : body.reason === "unsupported_media_type" ? 415 : 400;
    return noStoreJson({ error: body.reason === "too_large" ? "İstek gövdesi çok büyük." : "Geçersiz istek gövdesi." }, { status });
  }
  const passwordValid = await verifyCurrentUserPassword(user.id, body.payload.password);
  if (!passwordValid || !isAccountDeletionConfirmed(body.payload, user.username)) {
    return noStoreJson({ error: "Kimlik veya kalıcı silme onayı doğrulanamadı." }, { status: 400 });
  }

  let deleted = false;
  try {
    deleted = await deleteUserAccount(user.id);
  } catch {
    return noStoreJson({ error: "Hesap şu anda silinemedi. Hiçbir verin değiştirilmedi; lütfen yeniden dene." }, { status: 500 });
  }
  if (!deleted) {
    await destroySession();
    return noStoreJson({ error: "Hesap bulunamadı." }, { status: 404 });
  }

  await destroySession();
  return noStoreJson({ ok: true });
}
