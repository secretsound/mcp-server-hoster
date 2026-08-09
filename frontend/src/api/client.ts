const TOKEN_KEY = "mcp_hoster_session";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export async function api<T = Record<string, unknown>>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const token = getSessionToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : res.statusText || "request failed";
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export async function rawFetch(
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; statusText: string; body: string }> {
  const headers = new Headers(opts.headers);
  const token = getSessionToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const res = await fetch(path, { ...opts, headers });
  const body = await res.text();
  return { status: res.status, statusText: res.statusText, body };
}
