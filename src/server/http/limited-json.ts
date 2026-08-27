export class RequestBodyError extends Error {
  constructor(public readonly status: 400 | 413 | 415, message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readLimitedJsonObject(request: Request, maximumBytes: number): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RequestBodyError(415, "İstek gövdesi JSON olmalı.");
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new RequestBodyError(413, "İstek gövdesi çok büyük.");
  if (!request.body) throw new RequestBodyError(400, "İstek gövdesi eksik.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RequestBodyError(413, "İstek gövdesi çok büyük.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestBodyError(400, "JSON gövdesi geçersiz.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RequestBodyError(400, "JSON nesnesi gerekli.");
  return parsed as Record<string, unknown>;
}
