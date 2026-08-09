import { getSessionToken } from "./client";

export type SseHandlers = {
  onEvent?: (event: string, data: unknown) => void;
  onError?: (err: unknown) => void;
  onOpen?: () => void;
};

/**
 * Fetch-based SSE client (supports Authorization headers; EventSource cannot).
 * Returns an abort function.
 */
export function connectSse(
  path: string,
  handlers: SseHandlers = {},
): () => void {
  const ac = new AbortController();

  void (async () => {
    let attempt = 0;
    while (!ac.signal.aborted) {
      try {
        const headers = new Headers({
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const token = getSessionToken();
        if (token) headers.set("authorization", `Bearer ${token}`);

        const res = await fetch(path, {
          headers,
          signal: ac.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          throw new Error(`SSE ${res.status} ${res.statusText}`);
        }

        attempt = 0;
        handlers.onOpen?.();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "message";
        let dataLines: string[] = [];

        const flush = () => {
          if (!dataLines.length) {
            eventName = "message";
            return;
          }
          const raw = dataLines.join("\n");
          dataLines = [];
          const name = eventName;
          eventName = "message";
          let data: unknown = raw;
          try {
            data = JSON.parse(raw);
          } catch {
            /* keep string */
          }
          handlers.onEvent?.(name, data);
        };

        while (!ac.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";
          for (const line of parts) {
            if (line === "") {
              flush();
              continue;
            }
            if (line.startsWith(":")) continue;
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
              continue;
            }
            if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        handlers.onError?.(err);
      }

      if (ac.signal.aborted) return;
      attempt += 1;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 15_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  })();

  return () => ac.abort();
}
