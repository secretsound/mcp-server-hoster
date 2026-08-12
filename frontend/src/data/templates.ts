import i18n from "../i18n";
import type { ServerFormValues } from "../types";

export type TemplateDef = {
  id: string;
  label: string;
  note: string;
  values: ServerFormValues;
};

type TemplateBase = {
  id: string;
  values: ServerFormValues;
};

const TEMPLATE_BASES: TemplateBase[] = [
  {
    id: "npx",
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

/** Localized template list — call when rendering so locale switches apply. */
export function getTemplates(): TemplateDef[] {
  const t = i18n.global.t;
  return TEMPLATE_BASES.map((tmpl) => ({
    ...tmpl,
    label: String(t(`templates.${tmpl.id}.label`)),
    note: String(t(`templates.${tmpl.id}.note`)),
  }));
}

/** Snapshot for callers that only need values by id (labels may be stale). */
export const TEMPLATES: TemplateDef[] = getTemplates();

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

type EndpointBase = Omit<ApiEndpointExample, "desc"> & { descKey: string };

const ENDPOINT_BASES: EndpointBase[] = [
  {
    method: "GET",
    path: "/health",
    descKey: "templates.endpoints.health",
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
    descKey: "templates.endpoints.listServers",
    sampleResponse: { servers: [SAMPLE_SERVER] },
  },
  {
    method: "POST",
    path: "/api/servers",
    descKey: "templates.endpoints.createServer",
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
    descKey: "templates.endpoints.getServer",
    samplePath: "/api/servers/mealie",
    sampleResponse: { server: SAMPLE_SERVER },
  },
  {
    method: "PATCH",
    path: "/api/servers/:id",
    descKey: "templates.endpoints.updateServer",
    samplePath: "/api/servers/mealie",
    sampleBody: { name: "Mealie", enabled: true, packageVersion: "0.3.1" },
    sampleResponse: {
      server: { ...SAMPLE_SERVER, packageVersion: "0.3.1" },
    },
  },
  {
    method: "DELETE",
    path: "/api/servers/:id",
    descKey: "templates.endpoints.deleteServer",
    samplePath: "/api/servers/mealie",
    sampleResponse: { ok: true },
  },
  {
    method: "POST",
    path: "/api/servers/:id/start",
    descKey: "templates.endpoints.startServer",
    samplePath: "/api/servers/mealie/start",
    sampleResponse: { server: SAMPLE_SERVER },
  },
  {
    method: "POST",
    path: "/api/servers/:id/stop",
    descKey: "templates.endpoints.stopServer",
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
    descKey: "templates.endpoints.restartServer",
    samplePath: "/api/servers/mealie/restart",
    sampleResponse: { server: SAMPLE_SERVER },
  },
  {
    method: "POST",
    path: "/api/servers/:id/upgrade",
    descKey: "templates.endpoints.upgradeServer",
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
    descKey: "templates.endpoints.serverLogs",
    samplePath: "/api/servers/mealie/logs?tail=200",
    sampleResponse: {
      logs: "[2026-08-09T01:00:00Z] connected; 68 tools\n",
    },
  },
  {
    method: "GET",
    path: "/api/servers/:id/tools",
    descKey: "templates.endpoints.serverTools",
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
    descKey: "templates.endpoints.listLibrary",
    sampleResponse: {
      categories: [{ id: "apps", label: "Apps" }],
      items: [{ id: "mealie", name: "Mealie", category: "apps" }],
    },
  },
  {
    method: "POST",
    path: "/api/library/categories",
    descKey: "templates.endpoints.createCategory",
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
    descKey: "templates.endpoints.updateCategory",
    samplePath: "/api/library/categories/ops",
    sampleBody: { label: "Operations" },
    sampleResponse: {
      category: { id: "ops", label: "Operations" },
    },
  },
  {
    method: "DELETE",
    path: "/api/library/categories/:id",
    descKey: "templates.endpoints.deleteCategory",
    samplePath: "/api/library/categories/ops",
    sampleResponse: { ok: true },
  },
  {
    method: "GET",
    path: "/api/library/:id",
    descKey: "templates.endpoints.getLibraryItem",
    samplePath: "/api/library/mealie",
    sampleResponse: {
      item: { id: "mealie", name: "Mealie", category: "apps" },
    },
  },
  {
    method: "POST",
    path: "/api/library",
    descKey: "templates.endpoints.createLibraryItem",
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
    descKey: "templates.endpoints.updateLibraryItem",
    samplePath: "/api/library/custom-mcp",
    sampleBody: { blurb: "Updated description" },
    sampleResponse: {
      item: { id: "custom-mcp", blurb: "Updated description" },
    },
  },
  {
    method: "DELETE",
    path: "/api/library/:id",
    descKey: "templates.endpoints.deleteLibraryItem",
    samplePath: "/api/library/custom-mcp",
    sampleResponse: { ok: true },
  },
  {
    method: "GET",
    path: "/api/settings",
    descKey: "templates.endpoints.getSettings",
    sampleResponse: {
      settings: { "host.sandbox_mode": "auto" },
    },
  },
  {
    method: "PUT",
    path: "/api/settings",
    descKey: "templates.endpoints.updateSettings",
    sampleBody: { "host.sandbox_mode": "landlock" },
    sampleResponse: {
      settings: { "host.sandbox_mode": "landlock" },
      sandbox: { requested: "landlock", active: "landlock" },
    },
  },
  {
    method: "POST",
    path: "/mcp",
    descKey: "templates.endpoints.unifiedMcp",
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
    descKey: "templates.endpoints.perServerMcp",
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

/** Localized endpoint examples — call when rendering so locale switches apply. */
export function getEndpoints(): ApiEndpointExample[] {
  const t = i18n.global.t;
  return ENDPOINT_BASES.map(({ descKey, ...rest }) => ({
    ...rest,
    desc: String(t(descKey)),
  }));
}

/** Snapshot for modules that import at load time. Prefer getEndpoints(). */
export const ENDPOINTS: ApiEndpointExample[] = getEndpoints();

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
  const t = i18n.global.t;
  const tm = i18n.global.tm;
  const authRequired = opts.authRequired !== false;
  const bearerToken = (opts.bearerToken?.trim() || MCP_KEY_PLACEHOLDER);
  const headers = mcpAuthHeaders(authRequired, bearerToken);
  const authStep = authRequired
    ? String(t("connect.authStep", { token: bearerToken }))
    : String(t("connect.authDisabledStep"));
  const oauthNote = authRequired ? String(t("connect.oauthNote")) : null;

  const stepsOf = (key: string): string[] => {
    const raw = tm(key);
    return Array.isArray(raw) ? raw.map(String) : [];
  };

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

  const claudeDesktopSteps = stepsOf("connect.platforms.claudeDesktop.steps");
  const cursorSteps = stepsOf("connect.platforms.cursor.steps");
  const vscodeSteps = stepsOf("connect.platforms.vscode.steps");
  const claudeCodeSteps = stepsOf("connect.platforms.claudeCode.steps");
  const windsurfSteps = stepsOf("connect.platforms.windsurf.steps");
  const continueSteps = stepsOf("connect.platforms.continue.steps");
  const bifrostSteps = stepsOf("connect.platforms.bifrost.steps");
  const genericSteps = stepsOf("connect.platforms.generic.steps");

  return [
    ...(authRequired
      ? [{
        id: "oauth",
        name: String(t("connect.platforms.oauth.name")),
        blurb: String(t("connect.platforms.oauth.blurb")),
        steps: stepsOf("connect.platforms.oauth.steps"),
        snippets: [
          {
            label: String(t("connect.platforms.oauth.snippetUrlOnly")),
            code: cursorOauth,
          },
          {
            label: String(t("connect.platforms.oauth.snippetDiscovery")),
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
      name: String(t("connect.platforms.claudeDesktop.name")),
      blurb: String(t("connect.platforms.claudeDesktop.blurb")),
      steps: [
        claudeDesktopSteps[0]!,
        claudeDesktopSteps[1]!,
        ...(oauthNote ? [oauthNote] : []),
        authStep,
        claudeDesktopSteps[2]!,
      ],
      snippets: [
        ...(authRequired
          ? [{
            label: String(t("connect.platforms.claudeDesktop.snippetOauth")),
            code: cursorOauth,
          }]
          : []),
        {
          label: String(t("connect.platforms.claudeDesktop.snippetApiKey")),
          code: claudeDesktop,
        },
      ],
      docs: "https://modelcontextprotocol.io/docs/develop/connect-local-servers",
    },
    {
      id: "cursor",
      name: String(t("connect.platforms.cursor.name")),
      blurb: String(t("connect.platforms.cursor.blurb")),
      steps: [
        cursorSteps[0]!,
        cursorSteps[1]!,
        ...(oauthNote ? [oauthNote] : []),
        authStep,
        cursorSteps[2]!,
      ],
      snippets: [
        ...(authRequired
          ? [{
            label: String(t("connect.platforms.cursor.snippetOauth")),
            code: cursorOauth,
          }]
          : []),
        {
          label: String(t("connect.platforms.cursor.snippetApiKey")),
          code: cursor,
        },
      ],
    },
    {
      id: "vscode",
      name: String(t("connect.platforms.vscode.name")),
      blurb: String(t("connect.platforms.vscode.blurb")),
      steps: [
        vscodeSteps[0]!,
        vscodeSteps[1]!,
        authStep,
        vscodeSteps[2]!,
      ],
      snippets: [{
        label: String(t("connect.platforms.vscode.snippet")),
        code: vscode,
      }],
    },
    {
      id: "claude-code",
      name: String(t("connect.platforms.claudeCode.name")),
      blurb: String(t("connect.platforms.claudeCode.blurb")),
      steps: [
        claudeCodeSteps[0]!,
        authStep,
        claudeCodeSteps[1]!,
      ],
      snippets: [{
        label: String(t("connect.platforms.claudeCode.snippet")),
        code: claudeCode,
      }],
    },
    {
      id: "windsurf",
      name: String(t("connect.platforms.windsurf.name")),
      blurb: String(t("connect.platforms.windsurf.blurb")),
      steps: [
        windsurfSteps[0]!,
        windsurfSteps[1]!,
        authStep,
      ],
      snippets: [{
        label: String(t("connect.platforms.windsurf.snippet")),
        code: windsurf,
      }],
    },
    {
      id: "continue",
      name: String(t("connect.platforms.continue.name")),
      blurb: String(t("connect.platforms.continue.blurb")),
      steps: [
        continueSteps[0]!,
        continueSteps[1]!,
        authStep,
      ],
      snippets: [{
        label: String(t("connect.platforms.continue.snippet")),
        code: continueDev,
      }],
    },
    {
      id: "bifrost",
      name: String(t("connect.platforms.bifrost.name")),
      blurb: String(t("connect.platforms.bifrost.blurb")),
      steps: [
        bifrostSteps[0]!,
        bifrostSteps[1]!,
        bifrostSteps[2]!,
        bifrostSteps[3]!,
        authRequired
          ? String(t("connect.platforms.bifrost.authHeaders", {
            token: bearerToken,
          }))
          : String(t("connect.platforms.bifrost.authNone")),
        bifrostSteps[4]!,
      ],
      snippets: [
        {
          label: String(t("connect.platforms.bifrost.snippetJson")),
          code: bifrostJson,
        },
        {
          label: String(t("connect.platforms.bifrost.snippetApi")),
          code: bifrostCurl,
        },
      ],
      docs: "https://docs.getbifrost.ai/mcp/connecting-to-servers",
    },
    {
      id: "generic",
      name: String(t("connect.platforms.generic.name")),
      blurb: String(t("connect.platforms.generic.blurb")),
      steps: [
        genericSteps[0]!,
        genericSteps[1]!,
        genericSteps[2]!,
        authStep,
        genericSteps[3]!,
      ],
      snippets: [{
        label: String(t("connect.platforms.generic.snippet")),
        code: genericCurl,
      }],
    },
  ];
}
