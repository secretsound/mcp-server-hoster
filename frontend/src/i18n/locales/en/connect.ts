export default {
  title: "Connect",
  subtitle: "Point MCP clients at this host’s unified gateway.",
  apiKeyForSnippets: "API key for snippets",
  selectKey: "Select a key",
  authDisabledHint: "Auth is disabled — snippets omit Bearer headers.",
  noKeysYet: "No keys yet —",
  createOne: "create one",
  toScopeServers: "to scope which servers clients can reach.",
  pasteSecret:
    "Paste full secret (optional, only stored in this tab)",
  secretHint:
    "Secrets are shown once at creation. Without a paste, snippets use {placeholder}.",
  mcpUrlInSnippets: "MCP URL in snippets",
  perServer: "per-server",
  unified: "unified",
  copyUrl: "Copy URL",
  urlCopied: "URL copied",
  accountCanReach: "Your account can reach",
  keyCanReach: "This key can reach",
  pickKeyToSee: "Pick a key to see reachable servers",
  allTools: "all tools",
  toolsCount: "{count} tools",
  liveCount: "{count} live",
  limitedTools: "limited tools",
  allServers: "All servers",
  reachableHintAll: "{running} running · {tools} tools visible on host",
  reachableHintPartial:
    "{running}/{total} running · {tools} tools discovered",
  noServerScopes: "No server scopes configured.",
  testConnection: "Test connection",
  testHint: "Runs tools/list against the MCP URL above.",
  pasteSecretToTest:
    "Paste the full API key secret to test (prefix alone is not enough).",
  selectKeyOrOauth:
    "Select a key and paste its secret, or choose OAuth / session.",
  noCredentials: "No credentials available for the test call.",
  connectedTools:
    "Connected — tools/list returned {count} tool | Connected — tools/list returned {count} tools",
  placeholderOption: "Generic placeholder (mch_YOUR_API_KEY)",
  oauthOption: "OAuth / browser sign-in (no static key)",
  yourKeys: "Your keys",
  tenantKeys: "Tenant keys",
  transport: "Transport:",
  streamableHttp: "Streamable HTTP",
  unifiedLabel: "Unified",
  unifiedDesc: "— all running servers; tools named {pattern}",
  perServerLabel: "Per-server",
  perServerDesc: "— one backend, original tool names",
  authLabel: "Auth",
  authEnabledDesc:
    "— OAuth when the client supports it, or {bearer} from API keys. Session tokens ({session}) are UI-only.",
  authDisabledDesc:
    "— disabled on this host ({flag}); no Bearer needed",
  docs: "Docs:",
  authStep:
    "Auth: prefer OAuth (client opens a browser; you sign in and Allow). Or use an API key — Authorization: Bearer {token} from API keys (user key or tenant key for M2M). Session tokens mcs_… are admin-UI only.",
  authDisabledStep: "Auth is disabled on this host — no Bearer header needed.",
  oauthNote:
    "If the client supports MCP OAuth, add only the URL — it will discover /.well-known/oauth-protected-resource and open a browser to sign in.",
  platforms: {
    oauth: {
      name: "OAuth (browser sign-in)",
      blurb:
        "Clients that support MCP OAuth open a browser so you can sign in with your account. Tool access uses your user grants. Tenant API keys remain best for machine-to-machine.",
      steps: [
        "Add the gateway URL only (no static API key) in a client that supports remote MCP OAuth.",
        "On first connect the client discovers /.well-known/oauth-protected-resource, registers itself, and opens /oauth/authorize.",
        "Sign in (password or SSO), then Allow — the client receives an access token (mca_…) for your grants.",
        "For automation / shared services, use a tenant API key instead (see API keys).",
      ],
      snippetUrlOnly: "URL-only config (OAuth clients)",
      snippetDiscovery: "Discovery endpoints",
    },
    claudeDesktop: {
      name: "Claude Desktop",
      blurb: "Point Claude Desktop at the Streamable HTTP gateway.",
      steps: [
        "Open Claude Desktop → Settings → Developer → Edit Config.",
        "Merge the mcpServers block into claude_desktop_config.json.",
        "Restart Claude Desktop.",
      ],
      snippetOauth: "mcpServers (OAuth — URL only)",
      snippetApiKey: "claude_desktop_config.json (API key)",
    },
    cursor: {
      name: "Cursor",
      blurb: "Add the gateway as an MCP server in Cursor settings.",
      steps: [
        "Cursor Settings → MCP → Add new global MCP server (or edit mcp.json).",
        "Use type/url form if offered; otherwise paste the JSON below.",
        "Reload MCP servers / restart Cursor if tools do not appear.",
      ],
      snippetOauth: "mcp.json (OAuth — URL only)",
      snippetApiKey: "mcp.json (API key fallback)",
    },
    vscode: {
      name: "VS Code / Copilot",
      blurb: "Configure an HTTP MCP server in VS Code MCP settings.",
      steps: [
        "Command Palette → “MCP: Open User Configuration” (or workspace mcp.json).",
        "Add the servers entry below (VS Code 1.99+ HTTP MCP).",
        "Start the server from the MCP view if it does not auto-connect.",
      ],
      snippet: "mcp.json",
    },
    claudeCode: {
      name: "Claude Code",
      blurb: "Register the HTTP gateway with the Claude Code CLI.",
      steps: [
        "Run the command below in a terminal where claude is installed.",
        "Verify with claude mcp list.",
      ],
      snippet: "CLI",
    },
    windsurf: {
      name: "Windsurf",
      blurb: "Cascade MCP config using a remote server URL.",
      steps: [
        "Open Windsurf MCP settings / mcp_config.json.",
        "Add the serverUrl entry and reload Cascade.",
      ],
      snippet: "mcp_config.json",
    },
    continue: {
      name: "Continue",
      blurb: "Continue.dev config for a streamable HTTP MCP server.",
      steps: [
        "Edit ~/.continue/config.yaml or the JSON MCP section your Continue version uses.",
        "Add the streamable-http server and reload the extension.",
      ],
      snippet: "MCP server entry",
    },
    bifrost: {
      name: "Bifrost",
      blurb:
        "Add the unified gateway, or one Bifrost client per /mcp/{'<'}serverId{'>'} for cleaner upstream org.",
      steps: [
        "In Bifrost: MCP Gateway → New MCP Server (or Clients).",
        "Connection type: HTTP (Streamable HTTP).",
        "For everything: connection URL = unified /mcp below.",
        "For one backend: connection URL = /mcp/{'<'}serverId{'>'} (e.g. …/mcp/portainer) — tools keep original names.",
        "If Bifrost runs on another host, use a reachable MCP Hoster address.",
      ],
      authHeaders:
        "Auth type: Headers — Authorization: Bearer {token} (mint the key under API keys).",
      authNone: "Auth type: none (host auth is disabled).",
      snippetJson: "Bifrost client JSON (unified /mcp)",
      snippetApi: "Bifrost API example (adjust Bifrost host/port)",
    },
    generic: {
      name: "Generic HTTP / curl",
      blurb: "Any Streamable HTTP MCP client can POST JSON-RPC to the gateway.",
      steps: [
        "Transport: Streamable HTTP.",
        "Endpoint: POST (and GET for SSE where required) on the gateway URL.",
        "Accept: application/json, text/event-stream.",
        "Tools are namespaced as {serverId}__{toolName}.",
      ],
      snippet: "tools/list",
    },
  },
} as const;
