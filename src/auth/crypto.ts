const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = 210_000;
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `pbkdf2$${iterations}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const expected = parts[3];
  if (!Number.isFinite(iterations) || salt.length === 0 || !expected) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
  const actual = bytesToHex(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function newId(prefix = ""): string {
  const id = toBase64Url(randomBytes(16));
  return prefix ? `${prefix}_${id}` : id;
}

/** Generate a bearer API key. Secret is shown once; only the hash is stored. */
export function generateApiKeySecret(): { secret: string; prefix: string } {
  const secret = `mch_${toBase64Url(randomBytes(32))}`;
  return { secret, prefix: secret.slice(0, 12) };
}

export function generateSessionToken(): string {
  return `mcs_${toBase64Url(randomBytes(32))}`;
}

/** MCP OAuth authorization code (short-lived, one-time). */
export function generateOAuthAuthCode(): string {
  return `mcc_${toBase64Url(randomBytes(32))}`;
}

/** MCP OAuth access token (Bearer for /mcp). */
export function generateOAuthAccessToken(): string {
  return `mca_${toBase64Url(randomBytes(32))}`;
}

/** MCP OAuth refresh token. */
export function generateOAuthRefreshToken(): string {
  return `mcr_${toBase64Url(randomBytes(32))}`;
}

export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value),
  );
  return toBase64Url(new Uint8Array(digest));
}
