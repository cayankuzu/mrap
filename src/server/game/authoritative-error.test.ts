import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthoritativeGameError,
  gameError,
  gameErrorResponse,
} from "@/server/game/authoritative-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authoritative oyun hata sözleşmesi", () => {
  it("domain hatasının kod, durum ve retryable bilgisini korur", () => {
    const error = new AuthoritativeGameError("CONFLICT", "Sürüm çakıştı.", 409, true);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AuthoritativeGameError");
    expect(error.code).toBe("CONFLICT");
    expect(error.status).toBe(409);
    expect(error.retryable).toBe(true);
  });

  it("gameError varsayılan güvenli durumla aynı domain hatasını fırlatır", () => {
    expect(() => gameError("INVALID_REQUEST", "İstek geçersiz."))
      .toThrowError(expect.objectContaining({
        name: "AuthoritativeGameError",
        code: "INVALID_REQUEST",
        status: 400,
        retryable: false,
      }));
  });

  it("bilinen hatayı istemci sözleşmesi ve correlation header ile döndürür", async () => {
    const response = gameErrorResponse(
      new AuthoritativeGameError("RATE_LIMITED", "Çok fazla istek.", 429, true),
      "corr-known-001",
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("corr-known-001");
    await expect(response.json()).resolves.toEqual({
      error: "Çok fazla istek.",
      code: "RATE_LIMITED",
      retryable: true,
      correlationId: "corr-known-001",
    });
  });

  it("beklenmeyen hatanın ayrıntısını sızdırmadan retryable 500 üretir", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = gameErrorResponse(new Error("secret database detail"), "corr-unknown-001");
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("corr-unknown-001");
    expect(body).toMatchObject({
      code: "RETRYABLE",
      retryable: true,
      correlationId: "corr-unknown-001",
    });
    expect(JSON.stringify(body)).not.toContain("secret database detail");
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(JSON.stringify({
      level: "error",
      event: "authoritative_request_failed",
      correlationId: "corr-unknown-001",
    }));
  });
});
