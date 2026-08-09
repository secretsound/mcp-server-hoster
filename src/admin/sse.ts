import type { Context } from "hono";

export type SseSend = (event: string, data: unknown) => void;

/** Build a text/event-stream Response with an async producer. */
export function sseResponse(
  c: Context,
  run: (send: SseSend, signal: AbortSignal) => Promise<void> | void,
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: SseSend = (event, data) => {
        if (closed) return;
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${payload}\n\n`),
        );
      };

      const onAbort = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      c.req.raw.signal.addEventListener("abort", onAbort);

      // Comment line so proxies flush headers immediately
      controller.enqueue(encoder.encode(": connected\n\n"));

      void Promise.resolve(run(send, c.req.raw.signal))
        .catch((err) => {
          if (!closed) {
            console.error("[sse]", err);
            try {
              send("error", {
                error: err instanceof Error ? err.message : String(err),
              });
            } catch {
              /* ignore */
            }
          }
        })
        .finally(() => {
          c.req.raw.signal.removeEventListener("abort", onAbort);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              /* ignore */
            }
          }
        });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
