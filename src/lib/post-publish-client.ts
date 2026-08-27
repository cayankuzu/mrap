import { fingerprintPostPublishPayload, type PostPublishAttemptStore } from "@/lib/post-publish-attempt";

export const POST_PUBLISH_TIMEOUT_MS = (() => {
  const value = Number(process.env.NEXT_PUBLIC_MRAP_POST_PUBLISH_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 5_000 && value <= 60_000 ? Math.round(value) : 20_000;
})();

export type PostPublishPayload = {
  territoryId: string;
  title: string;
  body: string;
  images: string[];
  mapSnapshot: string;
  mapView: { center: [number, number]; zoom: number; bearing: number; pitch: number };
};

export type PostPublishResult =
  | { status: "success"; id: string }
  | { status: "busy" }
  | { status: "aborted" }
  | { status: "offline" | "timeout" | "network_error" | "invalid_response" | "server_error"; message: string };

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type IdempotencyKeyFactory = () => string;

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("Güvenli gönderim anahtarı üretilemedi.");
}

function safeServerMessage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = (value as { error?: unknown }).error;
  return typeof message === "string" && message.length > 0 && message.length <= 240 ? message : null;
}

export class PostPublishClient {
  private controller: AbortController | null = null;
  private pending = false;
  private retryIdentity: { fingerprint: string; key: string } | null = null;

  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMs = POST_PUBLISH_TIMEOUT_MS,
    private readonly keyFactory: IdempotencyKeyFactory = createIdempotencyKey,
    private readonly attemptStore?: PostPublishAttemptStore,
  ) {}

  isPending() {
    return this.pending;
  }

  abort() {
    this.controller?.abort();
  }

  async publish(payload: PostPublishPayload, options: { online: boolean }): Promise<PostPublishResult> {
    if (this.pending) return { status: "busy" };
    if (!options.online) return { status: "offline", message: "İnternet bağlantısı yok. Bağlantın geldiğinde taslağını yeniden gönderebilirsin." };

    const fingerprint = fingerprintPostPublishPayload(JSON.stringify(payload));
    let retryIdentity: { fingerprint: string; key: string };
    try {
      const previous = this.retryIdentity ?? this.attemptStore?.read() ?? null;
      retryIdentity = previous?.fingerprint === fingerprint
        ? previous
        : { fingerprint, key: this.keyFactory() };
      this.retryIdentity = retryIdentity;
      this.attemptStore?.write(retryIdentity);
    } catch {
      return { status: "invalid_response", message: "Güvenli gönderim hazırlanamadı. Taslağın korunuyor." };
    }
    this.pending = true;
    const controller = new AbortController();
    this.controller = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetcher("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: retryIdentity.key }),
        signal: controller.signal,
      });
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        return { status: "invalid_response", message: "Sunucudan okunabilir bir yanıt alınamadı. Taslağın korunuyor." };
      }
      if (!response.ok) {
        return { status: "server_error", message: safeServerMessage(result) ?? "Paylaşım oluşturulamadı. Taslağın korunuyor." };
      }
      const id = result && typeof result === "object" && !Array.isArray(result) ? (result as { id?: unknown }).id : null;
      if (typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        if (this.retryIdentity === retryIdentity) this.retryIdentity = null;
        this.attemptStore?.remove();
        return { status: "success", id };
      }
      return { status: "invalid_response", message: "Paylaşım doğrulanamadı. Taslağın korunuyor." };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return timedOut
          ? { status: "timeout", message: "Yayınlama zaman aşımına uğradı. Taslağın korunuyor; yeniden deneyebilirsin." }
          : { status: "aborted" };
      }
      return { status: "network_error", message: "Sunucuya ulaşılamadı. Taslağın korunuyor; yeniden deneyebilirsin." };
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
      this.pending = false;
    }
  }
}
