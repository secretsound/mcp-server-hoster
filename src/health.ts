import type { BootstrapConfig } from "./config.ts";
import type { AuthService } from "./auth/service.ts";
import type { ServerWithRuntime } from "./db/types.ts";
import type { SandboxModeRequest, SandboxRuntime } from "./sandbox_wrap.ts";

export type HealthCheck = {
  id: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
};

export async function buildHealthChecks(input: {
  config: BootstrapConfig;
  auth: AuthService;
  gateway: string;
  servers: ServerWithRuntime[];
  sandbox: SandboxRuntime;
  sandboxRequested: SandboxModeRequest;
}): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const oauth = await input.auth.getOAuthSettings();
  const publicUrl = oauth.publicUrl?.trim() || input.config.publicUrl?.trim() ||
    null;
  const enabledOauth = oauth.providers.filter((p) => p.enabled);

  if (!input.config.gatewayPublicUrl && input.config.bind === "0.0.0.0") {
    checks.push({
      id: "gateway_public_url",
      ok: false,
      severity: "warning",
      message:
        "GATEWAY_PUBLIC_URL is unset while listening on 0.0.0.0 — remote clients may need an explicit public /mcp URL.",
    });
  } else {
    checks.push({
      id: "gateway_public_url",
      ok: true,
      severity: "info",
      message: `Gateway advertised as ${input.gateway}`,
    });
  }

  if (enabledOauth.length && !publicUrl) {
    checks.push({
      id: "oauth_public_url",
      ok: false,
      severity: "error",
      message:
        "OAuth providers are enabled but Public URL is empty — set it under Settings → Authentication (or HOST_PUBLIC_URL).",
    });
  } else if (enabledOauth.length) {
    checks.push({
      id: "oauth_public_url",
      ok: true,
      severity: "info",
      message: `OAuth public URL: ${publicUrl}`,
    });
  }

  if (input.config.authDisabled) {
    checks.push({
      id: "auth_open",
      ok: false,
      severity: "error",
      message: "AUTH_DISABLED=1 — API and MCP accept unauthenticated access.",
    });
  } else if (!await input.auth.isRequired()) {
    checks.push({
      id: "auth_open",
      ok: false,
      severity: "warning",
      message:
        "AUTH_ALLOW_OPEN=1 — no users yet; API/MCP are open until the first admin is created.",
    });
  } else {
    checks.push({
      id: "auth_open",
      ok: true,
      severity: "info",
      message: "Authentication is required for admin and MCP clients.",
    });
  }

  if (input.sandbox.mode === "none") {
    checks.push({
      id: "sandbox",
      ok: false,
      severity: input.sandboxRequested === "none" ? "warning" : "error",
      message: input.sandbox.detail ??
        "MCP child processes are not filesystem-sandboxed.",
    });
  } else {
    checks.push({
      id: "sandbox",
      ok: true,
      severity: "info",
      message: `MCP children sandboxed via ${input.sandbox.mode} (setting: ${input.sandboxRequested})${
        input.sandbox.detail ? ` — ${input.sandbox.detail}` : ""
      }`,
    });
  }

  const crashed = input.servers.filter((s) => s.runtime.lastStatus === "error");
  if (crashed.length) {
    checks.push({
      id: "crashed_servers",
      ok: false,
      severity: "warning",
      message: `${crashed.length} server${crashed.length === 1 ? "" : "s"} in Crashed state: ${
        crashed.map((s) => s.id).join(", ")
      }`,
    });
  }

  return checks;
}
