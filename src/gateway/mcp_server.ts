import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import type { ProcessManager } from "../process_manager.ts";
import type { AuthService } from "../auth/service.ts";
import type { ScopeGrant } from "../auth/scopes.ts";
import { mcpWwwAuthenticate } from "../auth/mcp_oauth.ts";
import { createGatewayHandler } from "./aggregator.ts";

type McpHandler = { fetch: (request: Request) => Promise<Response> | Response };

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

async function challengeBaseUrl(request: Request, auth: AuthService): Promise<string> {
  const configured = await auth.publicBaseUrl();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return url.origin;
}

async function unauthorized(
  request: Request,
  auth: AuthService,
  message: string,
): Promise<Response> {
  return Response.json(
    { error: message },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": mcpWwwAuthenticate(await challengeBaseUrl(request, auth)),
      },
    },
  );
}

export function createMcpFetch(
  pm: ProcessManager,
  serverExists: (id: string) => boolean | Promise<boolean>,
  auth: AuthService,
) {
  const hosts = localhostAllowedHostnames();
  const origins = localhostAllowedOrigins();

  return async (request: Request): Promise<Response> => {
    const host = request.headers.get("host") ?? "";
    const isLocal = hosts.some((h) => host === h || host.startsWith(`${h}:`));
    if (isLocal) {
      const rejected =
        hostHeaderValidationResponse(request, hosts) ??
        originValidationResponse(request, origins);
      if (rejected) return rejected;
    } else {
      const rejected = originValidationResponse(request, origins);
      if (request.headers.get("origin") && rejected) return rejected;
    }

    let scopes: ScopeGrant[] | null = null;
    if (await auth.isRequired()) {
      const token = extractBearer(request);
      if (!token) {
        return await unauthorized(request, auth, "Authentication required");
      }
      const principal = await auth.resolveBearer(token);
      if (!principal) {
        return await unauthorized(request, auth, "Invalid or revoked credentials");
      }
      // MCP accepts: OAuth access (mca_), API keys (mch_), or sessions (mcs_).
      scopes = principal.scopes;
    }

    const url = new URL(request.url);
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    // /mcp → unified; /mcp/:serverId[/*] → scoped
    let serverId: string | undefined;
    if (parts[0] === "mcp" && parts[1]) {
      serverId = decodeURIComponent(parts[1]);
      if (!await serverExists(serverId)) {
        return Response.json(
          { error: `Unknown MCP server: ${serverId}` },
          { status: 404 },
        );
      }
      if (scopes && !scopes.some((g) => g.serverId === "*" || g.serverId === serverId)) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
      // Allow connect while stopped — tools/list will be empty until the process is running.
    }

    // Per-request handler so tool exposure matches the caller's scopes.
    const handler: McpHandler = createGatewayHandler(pm, { serverId, scopes });
    return handler.fetch(request);
  };
}
