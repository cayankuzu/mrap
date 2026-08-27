import { getCurrentUser } from "@/lib/auth";
import { getWorldVersion } from "@/lib/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Yetkisiz." }, { status: 401 });
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let lastVersion = -1;
  let cancelled = false;
  let requestInFlight = false;
  const stream = new ReadableStream({
    start(controller) {
      const stop = () => {
        cancelled = true;
        if (interval) clearInterval(interval);
      };
      const emit = async () => {
        if (cancelled || requestInFlight) return;
        requestInFlight = true;
        try {
          const version = await getWorldVersion();
          if (cancelled || version === lastVersion) return;
          lastVersion = version;
          controller.enqueue(encoder.encode(`event: territory\ndata: ${JSON.stringify({ version })}\n\n`));
        } catch (error) {
          stop();
          try { controller.error(error); } catch {}
        } finally {
          requestInFlight = false;
        }
      };
      void emit();
      interval = setInterval(() => { void emit(); }, 800);
      request.signal.addEventListener("abort", () => { stop(); try { controller.close(); } catch {} }, { once: true });
    },
    cancel() { cancelled = true; if (interval) clearInterval(interval); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
