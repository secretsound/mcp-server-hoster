import type { ServerFormValues } from "../types";

export type TemplateDef = {
  id: string;
  label: string;
  note: string;
  values: ServerFormValues;
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "npx",
    label: "npx package",
    note: "Run any Node MCP server published to npm. Uses npx -y <package> [args].",
    values: {
      id: "",
      name: "",
      launcher: "npx",
      package: "@modelcontextprotocol/server-everything",
      extraArgs: "",
      env: [{ key: "", value: "" }],
      git: "",
      ref: "",
      startNow: true,
    },
  },
  {
    id: "uvx",
    label: "uvx package",
    note: "Run a Python MCP server from PyPI (or a tool name uvx can resolve).",
    values: {
      id: "",
      name: "",
      launcher: "uvx",
      package: "mcp-server-time",
      extraArgs: "",
      env: [{ key: "", value: "" }],
      git: "",
      ref: "",
      startNow: true,
    },
  },
  {
    id: "uvx-git",
    label: "uvx from Git",
    note: "Run a Python MCP server directly from a Git repo via uvx --from git+https://…",
    values: {
      id: "",
      name: "",
      launcher: "custom",
      command: "uvx",
      argsLines: [
        "--from",
        "git+https://github.com/org/mcp-server",
        "mcp-server",
      ].join("\n"),
      env: [{ key: "", value: "" }],
      git: "",
      ref: "",
      startNow: true,
    },
  },
  {
    id: "git-clone",
    label: "Git clone + run",
    note: "Clone a repo into the server sandbox, then run a command from that checkout.",
    values: {
      id: "",
      name: "",
      launcher: "custom",
      command: "npx",
      argsLines: ["-y", ".", "start"].join("\n"),
      env: [{ key: "", value: "" }],
      git: "https://github.com/org/mcp-server.git",
      ref: "main",
      startNow: true,
    },
  },
  {
    id: "custom",
    label: "Custom command",
    note: "Any binary on PATH — node, python, docker, a local script, etc.",
    values: {
      id: "",
      name: "",
      launcher: "custom",
      command: "",
      argsLines: "",
      env: [{ key: "", value: "" }],
      git: "",
      ref: "",
      startNow: true,
    },
  },
];

export type ApiEndpointExample = {
  method: string;
  path: string;
  desc: string;
  /** Path filled into the request lab (placeholders resolved). */
  samplePath?: string;
  /** JSON body example for non-GET methods (object or null for none). */
  sampleBody?: unknown;
  /** Example JSON response shown when the endpoint is selected. */
  sampleResponse?: unknown;
};

const SAMPLE_SERVER = {
  id: "mealie",
  name: "Mealie",
  command: "uvx",
  args: ["mcp-mealie"],
  enabled: true,
  packageName: "mcp-mealie",
  packageVersion: null,
  toolCount: 68,
  runtime: { lastStatus: "running", pid: 12345 },
};

export const ENDPOINTS: ApiEndpointExample[] = [
  {
    method: "GET",
    path: "/health",
    desc: "Host + per-server process health",
    sampleResponse: {
      ok: true,
      port: 8080,
      gateway: "http://localhost:8080/mcp",
      servers: [{ id: "mealie", status: "running", tools: 68 }],
    },
  },
  {
    method: "GET",
    path: "/api/servers",
    desc: "List configured servers",
    sampleResponse: { servers: [SAMPLE_SERVER] },
  },
  {
    method: "POST",
    path: "/api/servers",
    desc: "Create a server (JSON body)",
    sampleBody: {
      id: "mealie",
      name: "Mealie",
      command: "uvx",
      args: ["mcp-mealie"],
      env: { MEALIE_BASE_URL: "https://mealie.example.com" },
      enabled: true,
    },
    sampleResponse: { server: SAMPLE_SERVER },
  },
  {
    method: "GET",
    path: "/api/servers/:id",
    desc: "Get one server",
    samplePath: "/api/servers/mealie",
    sampleResponse: { server: SAMPLE_SERVER },
  },
  {
    method: "PATCH",
    path: "/api/servers/:id",
    desc: "Update server config",
    samplePath: "/api/servers/mealie",
    sampleBody: { name: "Mealie", enabled: true, packageVersion: "0.3.1" },
    sampleResponse: {
      server: { ...SAMPLE_SERVER, packageVersion: "0.3.1" },
    },
  },
  {
    method: "DELETE",
    path: "/api/servers/:id",
    desc: "Delete a server",
    samplePath: "/api/servers/mealie",
    sampleResponse: { ok: true },
  },
  {
    method: "POST",
    path: "/api/servers/:id/start",
    desc: "Start process + MCP client",
    samplePath: "/api/servers/mealie/start",
    sampleResponse: { server: SAMPLE_SERVER },
  },
  {
    method: "POST",
    path: "/api/servers/:id/stop",
    desc: "Stop process",
    samplePath: "/api/servers/mealie/stop",
    sampleResponse: {
      server: {
        ...SAMPLE_SERVER,
        runtime: { lastStatus: "stopped", pid: null },
      },
    },
  },
  {
    method: "POST",
    path: "/api/servers/:id/restart",
    desc: "Restart process",
    samplePath: "/api/servers/mealie/restart",
    sampleResponse: { server: SAMPLE_SERVER },
  },
  {
    method: "POST",
    path: "/api/servers/:id/upgrade",
    desc: "Pin/upgrade package or git ref (optional clearCache)",
    samplePath: "/api/servers/mealie/upgrade",
    sampleBody: { version: null, clearCache: true },
    sampleResponse: {
      server: SAMPLE_SERVER,
      upgrade: {
        kind: "uvx",
        name: "mcp-mealie",
        version: null,
        label: "mcp-mealie (latest)",
      },
    },
  },
  {
    method: "GET",
    path: "/api/servers/:id/logs?tail=200",
    desc: "Tail on-disk logs",
    samplePath: "/api/servers/mealie/logs?tail=200",
    sampleResponse: {
      logs: "[2026-08-09T01:00:00Z] connected; 68 tools\n",
    },
  },
  {
    method: "GET",
    path: "/api/servers/:id/tools",
    desc: "Discovered tools (when running)",
    samplePath: "/api/servers/mealie/tools",
    sampleResponse: {
      tools: [
        {
          name: "get_recipes",
          namespacedName: "mealie__get_recipes",
          enabled: true,
        },
      ],
      disabledTools: [],
    },
  },
  {
    method: "GET",
    path: "/api/library",
    desc: "List library categories + items",
    sampleResponse: {
      categories: [{ id: "apps", label: "Apps" }],
      items: [{ id: "mealie", name: "Mealie", category: "apps" }],
    },
  },
  {
    method: "POST",
    path: "/api/library/categories",
    desc: "Create a library category",
    sampleBody: {
      id: "ops",
      label: "Ops",
      description: "Operations tools",
    },
    sampleResponse: {
      category: { id: "ops", label: "Ops", description: "Operations tools" },
    },
  },
  {
    method: "PATCH",
    path: "/api/library/categories/:id",
    desc: "Update a library category",
    samplePath: "/api/library/categories/ops",
    sampleBody: { label: "Operations" },
    sampleResponse: {
      category: { id: "ops", label: "Operations" },
    },
  },
  {
    method: "DELETE",
    path: "/api/library/categories/:id",
    desc: "Delete a library category",
    samplePath: "/api/library/categories/ops",
    sampleResponse: { ok: true },
  },
  {
    method: "GET",
    path: "/api/library/:id",
    desc: "Get one library item",
    samplePath: "/api/library/mealie",
    sampleResponse: {
      item: { id: "mealie", name: "Mealie", category: "apps" },
    },
  },
  {
    method: "POST",
    path: "/api/library",
    desc: "Create a library item",
    sampleBody: {
      id: "custom-mcp",
      name: "Custom MCP",
      blurb: "My internal server",
      category: "utilities",
      tags: ["custom"],
      source: "internal",
      preset: {
        id: "custom-mcp",
        name: "Custom MCP",
        launcher: "npx",
        package: "@org/mcp-server",
        env: [],
        git: "",
        ref: "",
        startNow: true,
      },
    },
    sampleResponse: { item: { id: "custom-mcp", name: "Custom MCP" } },
  },
  {
    method: "PATCH",
    path: "/api/library/:id",
    desc: "Update a library item",
    samplePath: "/api/library/custom-mcp",
    sampleBody: { blurb: "Updated description" },
    sampleResponse: {
      item: { id: "custom-mcp", blurb: "Updated description" },
    },
  },
  {
    method: "DELETE",
    path: "/api/library/:id",
    desc: "Delete a library item",
    samplePath: "/api/library/custom-mcp",
    sampleResponse: { ok: true },
  },
  {
    method: "GET",
    path: "/api/settings",
    desc: "Host settings key/values",
    sampleResponse: {
      settings: { "host.sandbox_mode": "auto" },
    },
  },
  {
    method: "PUT",
    path: "/api/settings",
    desc: "Update settings (JSON object)",
    sampleBody: { "host.sandbox_mode": "landlock" },
    sampleResponse: {
      settings: { "host.sandbox_mode": "landlock" },
      sandbox: { requested: "landlock", active: "landlock" },
    },
  },
  {
    method: "POST",
    path: "/mcp",
    desc: "Unified Streamable HTTP MCP gateway (all servers, namespaced tools)",
    sampleBody: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    },
    sampleResponse: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "mealie__get_recipes",
            description: "[mealie] List recipes",
          },
        ],
      },
    },
  },
  {
    method: "POST",
    path: "/mcp/:serverId",
    desc: "Per-server MCP endpoint (original tool names)",
    samplePath: "/mcp/mealie",
    sampleBody: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    },
    sampleResponse: {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "get_recipes", description: "List recipes" }],
      },
    },
  },
];

export type ConnectPlatform = {
  id: string;
  name: string;
  blurb: string;
  open?: boolean;
  steps: string[];
  snippets: Array<{ label: string; code: string }>;
  docs?: string;
};

const MCP_KEY_PLACEHOLDER = "mch_YOUR_API_KEY";

function mcpAuthHeaders(
  authRequired: boolean,
  bearerToken: string,
): Record<string, string> | undefined {
  if (!authRequired) return undefined;
  return { Authorization: `Bearer ${bearerToken}` };
}

export function connectPlatforms(
  url: string,
  opts: { authRequired?: boolean; bearerToken?: string } = {},
): ConnectPlatform[] {
  const authRequired = opts.authRequired !== false;
  const bearerToken = (opts.bearerToken?.trim() || MCP_KEY_PLACEHOLDER);
  const headers = mcpAuthHeaders(authRequired, bearerToken);
  const authStep = authRequired
    ? `Auth: prefer OAuth (client opens a browser; you sign in and Allow). Or use an API key — Authorization: Bearer ${bearerToken} from API keys (user key or tenant key for M2M). Session tokens mcs_… are admin-UI only.`
    : "Auth is disabled on this host — no Bearer header needed.";
  const oauthNote = authRequired
    ? "If the client supports MCP OAuth, add only the URL — it will discover /.well-known/oauth-protected-resource and open a browser to sign in."
    : null;

  const bifrostClient = {
    name: "mcp-hoster",
    connection_type: "http",
    connection_string: url,
    ...(authRequired
      ? {
          auth_type: "headers",
          headers: {
            Authorization: `Bearer ${bearerToken}`,
          },
        }
      : { auth_type: "none" }),
    tools_to_execute: ["*"],
  };
  const bifrostJson = JSON.stringify(bifrostClient, null, 2);
  const bifrostCurl = [
    "curl -X POST http://localhost:8080/api/mcp/client \\",
    '  -H "Content-Type: application/json" \\',
    "  -d '" + JSON.stringify(bifrostClient) + "'",
  ].join("\n");

  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        "mcp-hoster": {
          url,
          ...(headers ? { headers } : {}),
        },
      },
    },
    null,
    2,
  );
  const cursor = JSON.stringify(
    {
      mcpServers: {
        "mcp-hoster": {
          url,
          ...(headers ? { headers } : {}),
        },
      },
    },
    null,
    2,
  );
  const vscode = JSON.stringify(
    {
      servers: {
        "mcp-hoster": {
          type: "http",
          url,
          ...(headers ? { headers } : {}),
        },
      },
    },
    null,
    2,
  );
  const claudeCode = authRequired
    ? `claude mcp add --transport http mcp-hoster ${url} \\\n  --header "Authorization: Bearer ${bearerToken}"`
    : `claude mcp add --transport http mcp-hoster ${url}`;
  const windsurf = JSON.stringify(
    {
      mcpServers: {
        "mcp-hoster": {
          serverUrl: url,
          ...(headers ? { headers } : {}),
        },
      },
    },
    null,
    2,
  );
  const continueDev = JSON.stringify(
    {
      mcpServers: [
        {
          name: "mcp-hoster",
          type: "streamable-http",
          url,
          ...(headers ? { headers } : {}),
        },
      ],
    },
    null,
    2,
  );
  const genericCurl = [
    `curl -s ${url} \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "Accept: application/json, text/event-stream" \\',
    ...(authRequired
      ? [`  -H "Authorization: Bearer ${bearerToken}" \\`]
      : []),
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
  ].join("\n");

  const cursorOauth = JSON.stringify(
    { mcpServers: { "mcp-hoster": { url } } },
    null,
    2,
  );

  return [
    ...(authRequired
      ? [{
        id: "oauth",
        name: "OAuth (browser sign-in)",
        blurb:
          "Clients that support MCP OAuth open a browser so you can sign in with your account. Tool access uses your user grants. Tenant API keys remain best for machine-to-machine.",
        steps: [
          "Add the gateway URL only (no static API key) in a client that supports remote MCP OAuth.",
          "On first connect the client discovers /.well-known/oauth-protected-resource, registers itself, and opens /oauth/authorize.",
          "Sign in (password or SSO), then Allow — the client receives an access token (mca_…) for your grants.",
          "For automation / shared services, use a tenant API key instead (see API keys).",
        ],
        snippets: [
          {
            label: "URL-only config (OAuth clients)",
            code: cursorOauth,
          },
          {
            label: "Discovery endpoints",
            code: [
              `${url.replace(/\/mcp\/?$/, "")}/.well-known/oauth-protected-resource`,
              `${url.replace(/\/mcp\/?$/, "")}/.well-known/oauth-authorization-server`,
              `${url.replace(/\/mcp\/?$/, "")}/oauth/authorize`,
              `${url.replace(/\/mcp\/?$/, "")}/oauth/token`,
              `${url.replace(/\/mcp\/?$/, "")}/oauth/register`,
            ].join("\n"),
          },
        ],
      } satisfies ConnectPlatform]
      : []),
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      blurb: "Point Claude Desktop at the Streamable HTTP gateway.",
      steps: [
        "Open Claude Desktop → Settings → Developer → Edit Config.",
        "Merge the mcpServers block into claude_desktop_config.json.",
        ...(oauthNote ? [oauthNote] : []),
        authStep,
        "Restart Claude Desktop.",
      ],
      snippets: [
        ...(authRequired
          ? [{ label: "mcpServers (OAuth — URL only)", code: cursorOauth }]
          : []),
        { label: "claude_desktop_config.json (API key)", code: claudeDesktop },
      ],
      docs: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
    },
    {
      id: "cursor",
      name: "Cursor",
      blurb: "Add the gateway as an MCP server in Cursor settings.",
      steps: [
        "Cursor Settings → MCP → Add new global MCP server (or edit mcp.json).",
        "Use type/url form if offered; otherwise paste the JSON below.",
        ...(oauthNote ? [oauthNote] : []),
        authStep,
        "Reload MCP servers / restart Cursor if tools do not appear.",
      ],
      snippets: [
        ...(authRequired
          ? [{ label: "mcp.json (OAuth — URL only)", code: cursorOauth }]
          : []),
        { label: "mcp.json (API key fallback)", code: cursor },
      ],
    },
    {
      id: "vscode",
      name: "VS Code / Copilot",
      blurb: "Configure an HTTP MCP server in VS Code MCP settings.",
      steps: [
        "Command Palette → “MCP: Open User Configuration” (or workspace mcp.json).",
        "Add the servers entry below (VS Code 1.99+ HTTP MCP).",
        authStep,
        "Start the server from the MCP view if it does not auto-connect.",
      ],
      snippets: [{ label: "mcp.json", code: vscode }],
    },
    {
      id: "claude-code",
      name: "Claude Code",
      blurb: "Register the HTTP gateway with the Claude Code CLI.",
      steps: [
        "Run the command below in a terminal where claude is installed.",
        authStep,
        "Verify with claude mcp list.",
      ],
      snippets: [{ label: "CLI", code: claudeCode }],
    },
    {
      id: "windsurf",
      name: "Windsurf",
      blurb: "Cascade MCP config using a remote server URL.",
      steps: [
        "Open Windsurf MCP settings / mcp_config.json.",
        "Add the serverUrl entry and reload Cascade.",
        authStep,
      ],
      snippets: [{ label: "mcp_config.json", code: windsurf }],
    },
    {
      id: "continue",
      name: "Continue",
      blurb: "Continue.dev config for a streamable HTTP MCP server.",
      steps: [
        "Edit ~/.continue/config.yaml or the JSON MCP section your Continue version uses.",
        "Add the streamable-http server and reload the extension.",
        authStep,
      ],
      snippets: [{ label: "MCP server entry", code: continueDev }],
    },
    {
      id: "bifrost",
      name: "Bifrost",
      blurb:
        "Add the unified gateway, or one Bifrost client per /mcp/<serverId> for cleaner upstream org.",
      steps: [
        "In Bifrost: MCP Gateway → New MCP Server (or Clients).",
        "Connection type: HTTP (Streamable HTTP).",
        "For everything: connection URL = unified /mcp below.",
        "For one backend: connection URL = /mcp/<serverId> (e.g. …/mcp/portainer) — tools keep original names.",
        authRequired
          ? `Auth type: Headers — Authorization: Bearer ${bearerToken} (mint the key under API keys).`
          : "Auth type: none (host auth is disabled).",
        "If Bifrost runs on another host, use a reachable MCP Hoster address.",
      ],
      snippets: [
        { label: "Bifrost client JSON (unified /mcp)", code: bifrostJson },
        {
          label: "Bifrost API example (adjust Bifrost host/port)",
          code: bifrostCurl,
        },
      ],
      docs: "https://docs.getbifrost.ai/mcp/connecting-to-servers",
    },
    {
      id: "generic",
      name: "Generic HTTP / curl",
      blurb: "Any Streamable HTTP MCP client can POST JSON-RPC to the gateway.",
      steps: [
        "Transport: Streamable HTTP.",
        "Endpoint: POST (and GET for SSE where required) on the gateway URL.",
        "Accept: application/json, text/event-stream.",
        authStep,
        "Tools are namespaced as {serverId}__{toolName}.",
      ],
      snippets: [{ label: "tools/list", code: genericCurl }],
    },
  ];
}
