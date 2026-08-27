import { afterEach, describe, expect, it, vi } from "vitest";
import { PostPublishClient, type PostPublishPayload } from "@/lib/post-publish-client";

const payload: PostPublishPayload = {
  territoryId: "territory-1",
  title: "Sahil rotası",
  body: "Bugünün alanı.",
  images: [],
  mapSnapshot: "data:image/jpeg;base64,/9j/2Q==",
  mapView: { center: [29, 41], zoom: 14, bearing: 0, pitch: 0 },
};

afterEach(() => vi.useRealTimers());

describe("gönderi yayınlama istemcisi", () => {
  it("offline durumda ağa çıkmaz ve yeniden denenebilir sonuç döndürür", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new PostPublishClient(fetcher);

    await expect(client.publish(payload, { online: false })).resolves.toMatchObject({ status: "offline" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("bozuk JSON yanıtını yakalar ve taslağı kaybettirecek bir başarı üretmez", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{bozuk", { status: 201 }));
    const client = new PostPublishClient(fetcher);

    await expect(client.publish(payload, { online: true })).resolves.toMatchObject({ status: "invalid_response" });
    expect(client.isPending()).toBe(false);
  });

  it("eşzamanlı ikinci gönderimi pending kilidiyle engeller", async () => {
    let release: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((resolve) => { release = resolve; }));
    const client = new PostPublishClient(fetcher);

    const first = client.publish(payload, { online: true });
    await expect(client.publish(payload, { online: true })).resolves.toEqual({ status: "busy" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    release?.(Response.json({ id: "post-1" }, { status: 201 }));
    await expect(first).resolves.toEqual({ status: "success", id: "post-1" });
  });

  it("timeout olduğunda aktif isteği AbortController ile iptal eder", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const client = new PostPublishClient(fetcher, 5_000);

    const request = client.publish(payload, { online: true });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(request).resolves.toMatchObject({ status: "timeout" });
    expect((fetcher.mock.calls[0]?.[1]?.signal as AbortSignal).aborted).toBe(true);
  });

  it("yanıt kaybından sonraki aynı payload retry'ında aynı idempotency anahtarını kullanır", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("socket kapandı"))
      .mockResolvedValueOnce(Response.json({ id: "post-1" }, { status: 201 }));
    const keyFactory = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    const client = new PostPublishClient(fetcher, 5_000, keyFactory);

    await expect(client.publish(payload, { online: true })).resolves.toMatchObject({ status: "network_error" });
    await expect(client.publish(payload, { online: true })).resolves.toEqual({ status: "success", id: "post-1" });

    const firstBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { idempotencyKey: string };
    const secondBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as { idempotencyKey: string };
    expect(firstBody.idempotencyKey).toBe("11111111-2222-4333-8444-555555555555");
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
    expect(keyFactory).toHaveBeenCalledTimes(1);
  });

  it("payload değiştiğinde önceki denemenin anahtarını yeniden kullanmaz", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("çevrimdışı"));
    const keyFactory = vi.fn()
      .mockReturnValueOnce("11111111-2222-4333-8444-555555555555")
      .mockReturnValueOnce("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    const client = new PostPublishClient(fetcher, 5_000, keyFactory);

    await client.publish(payload, { online: true });
    await client.publish({ ...payload, title: "Değişen başlık" }, { online: true });

    const firstBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { idempotencyKey: string };
    const secondBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as { idempotencyKey: string };
    expect(secondBody.idempotencyKey).not.toBe(firstBody.idempotencyKey);
    expect(keyFactory).toHaveBeenCalledTimes(2);
  });

  it("yanıt kaybından sonra yeni client örneğinde session attempt kimliğini replay eder", async () => {
    let identity: { fingerprint: string; key: string } | null = null;
    const attemptStore = {
      read: vi.fn(() => identity),
      write: vi.fn((next: { fingerprint: string; key: string }) => { identity = next; }),
      remove: vi.fn(() => { identity = null; }),
    };
    const firstFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("yanıt kayboldu"));
    const firstClient = new PostPublishClient(firstFetch, 5_000, () => "11111111-2222-4333-8444-555555555555", attemptStore);
    await firstClient.publish(payload, { online: true });

    const secondFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "post-1" }, { status: 201 }));
    const newKeyFactory = vi.fn(() => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    const secondClient = new PostPublishClient(secondFetch, 5_000, newKeyFactory, attemptStore);
    await expect(secondClient.publish(payload, { online: true })).resolves.toEqual({ status: "success", id: "post-1" });

    const retriedBody = JSON.parse(String(secondFetch.mock.calls[0]?.[1]?.body)) as { idempotencyKey: string };
    expect(retriedBody.idempotencyKey).toBe("11111111-2222-4333-8444-555555555555");
    expect(newKeyFactory).not.toHaveBeenCalled();
    expect(attemptStore.remove).toHaveBeenCalledTimes(1);
  });
});
