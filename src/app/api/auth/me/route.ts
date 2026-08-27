import { getCurrentUser } from "@/lib/auth";
import { noStoreJson } from "@/server/http/api-security";

export async function GET() {
  const user = await getCurrentUser();
  return user ? noStoreJson({ user }) : noStoreJson({ error: "Oturum bulunamadı." }, { status: 401 });
}
