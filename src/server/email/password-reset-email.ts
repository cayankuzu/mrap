import "server-only";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_EMAIL_TIMEOUT_MS = 8_000;
const MINIMUM_EMAIL_TIMEOUT_MS = 1_000;
const MAXIMUM_EMAIL_TIMEOUT_MS = 15_000;

type PasswordResetEmailEnvironment = Readonly<{
  [key: string]: string | undefined;
  RESEND_API_KEY?: string;
  MRAP_EMAIL_FROM?: string;
  MRAP_EMAIL_TIMEOUT_MS?: string;
}>;

export type PasswordResetEmailFailureReason =
  | "configuration_missing"
  | "provider_rejected"
  | "timeout"
  | "network_error";

export type PasswordResetEmailResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason: PasswordResetEmailFailureReason;
      providerStatus?: number;
    }>;

type SendPasswordResetEmailOptions = Readonly<{
  environment?: PasswordResetEmailEnvironment;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}>;

function boundedTimeout(value: number) {
  return Number.isFinite(value) && value >= MINIMUM_EMAIL_TIMEOUT_MS && value <= MAXIMUM_EMAIL_TIMEOUT_MS
    ? Math.round(value)
    : DEFAULT_EMAIL_TIMEOUT_MS;
}

export function resolvePasswordResetEmailTimeout(
  environment: PasswordResetEmailEnvironment = process.env,
) {
  return boundedTimeout(Number(environment.MRAP_EMAIL_TIMEOUT_MS));
}

export async function sendPasswordResetEmail(
  input: Readonly<{ email: string; resetUrl: string }>,
  options: SendPasswordResetEmailOptions = {},
): Promise<PasswordResetEmailResult> {
  const environment = options.environment ?? process.env;
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = environment.MRAP_EMAIL_FROM?.trim();
  if (!apiKey || !from) return { ok: false, reason: "configuration_missing" };

  const controller = new AbortController();
  const timeoutMs = boundedTimeout(options.timeoutMs ?? resolvePasswordResetEmailTimeout(environment));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: "mrap şifre yenileme",
        html: `<p>Şifreni yenilemek için aşağıdaki güvenli bağlantıyı kullan.</p><p><a href="${input.resetUrl}">Şifremi yenile</a></p><p>Bağlantı 20 dakika sonra geçersiz olur.</p>`,
      }),
      signal: controller.signal,
    });

    return response.ok
      ? { ok: true }
      : { ok: false, reason: "provider_rejected", providerStatus: response.status };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timeout);
  }
}
