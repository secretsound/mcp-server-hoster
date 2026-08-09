export type AdminBusEvent =
  | { type: "servers" }
  | { type: "log"; logPath: string; chunk: string };

type Listener = (event: AdminBusEvent) => void;

const listeners = new Set<Listener>();

export const adminBus = {
  emit(event: AdminBusEvent): void {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error("[admin-bus] listener error:", err);
      }
    }
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
