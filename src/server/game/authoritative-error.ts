export type GameErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_SESSION"
  | "SESSION_CONFLICT"
  | "SESSION_EXPIRED"
  | "SESSION_REVOKED"
  | "NONCE_MISMATCH"
  | "SEQUENCE_GAP"
  | "IDEMPOTENCY_CONFLICT"
  | "NO_LOOP_AVAILABLE"
  | "CANDIDATE_EXPIRED"
  | "INVALID_ROUTE"
  | "INVALID_GEOMETRY"
  | "INVALID_COLOR"
  | "RATE_LIMITED"
  | "PRODUCTION_SIMULATION_FORBIDDEN"
  | "CLAIM_TOO_LARGE"
  | "RESTRICTED_REGION"
  | "CONFLICT"
  | "RETRYABLE";

export class AuthoritativeGameError extends Error {
  constructor(
    public readonly code: GameErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AuthoritativeGameError";
  }
}

export function gameError(code: GameErrorCode, message: string, status = 400, retryable = false): never {
  throw new AuthoritativeGameError(code, message, status, retryable);
}

export function gameErrorResponse(error: unknown, correlationId: string) {
  if (error instanceof AuthoritativeGameError) {
    return Response.json(
      { error: error.message, code: error.code, retryable: error.retryable, correlationId },
      { status: error.status, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } },
    );
  }
  console.error(JSON.stringify({ level: "error", event: "authoritative_request_failed", correlationId }));
  return Response.json(
    { error: "İşlem güvenli biçimde tamamlanamadı.", code: "RETRYABLE", retryable: true, correlationId },
    { status: 500, headers: { "Cache-Control": "no-store", "X-Correlation-Id": correlationId } },
  );
}
