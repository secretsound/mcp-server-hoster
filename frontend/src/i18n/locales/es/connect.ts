export default {
  title: "Conectar",
  subtitle: "Apunta clientes MCP a la puerta de enlace unificada de este host.",
  apiKeyForSnippets: "Clave API para los fragmentos",
  selectKey: "Selecciona una clave",
  authDisabledHint:
    "La autenticación está desactivada — los fragmentos omiten cabeceras Bearer.",
  noKeysYet: "Aún no hay claves —",
  createOne: "crea una",
  toScopeServers: "para delimitar a qué servidores pueden acceder los clientes.",
  pasteSecret:
    "Pega el secreto completo (opcional, solo se guarda en esta pestaña)",
  secretHint:
    "Los secretos se muestran una sola vez al crearlos. Sin pegar, los fragmentos usan {placeholder}.",
  mcpUrlInSnippets: "URL MCP en los fragmentos",
  perServer: "por servidor",
  unified: "unificada",
  copyUrl: "Copiar URL",
  urlCopied: "URL copiada",
  accountCanReach: "Tu cuenta puede acceder a",
  keyCanReach: "Esta clave puede acceder a",
  pickKeyToSee: "Elige una clave para ver los servidores alcanzables",
  allTools: "todas las herramientas",
  toolsCount: "{count} herramientas",
  liveCount: "{count} en vivo",
  limitedTools: "herramientas limitadas",
  allServers: "Todos los servidores",
  reachableHintAll:
    "{running} en ejecución · {tools} herramientas visibles en el host",
  reachableHintPartial:
    "{running}/{total} en ejecución · {tools} herramientas descubiertas",
  noServerScopes: "No hay alcances de servidor configurados.",
  testConnection: "Probar conexión",
  testHint: "Ejecuta tools/list contra la URL MCP de arriba.",
  pasteSecretToTest:
    "Pega el secreto completo de la clave API para probar (el prefijo solo no basta).",
  selectKeyOrOauth:
    "Selecciona una clave y pega su secreto, o elige OAuth / sesión.",
  noCredentials: "No hay credenciales disponibles para la prueba.",
  connectedTools:
    "Conectado — tools/list devolvió {count} herramienta | Conectado — tools/list devolvió {count} herramientas",
  placeholderOption: "Marcador genérico (mch_YOUR_API_KEY)",
  oauthOption: "OAuth / inicio de sesión en el navegador (sin clave estática)",
  yourKeys: "Tus claves",
  tenantKeys: "Claves del inquilino",
  transport: "Transporte:",
  streamableHttp: "Streamable HTTP",
  unifiedLabel: "Unificada",
  unifiedDesc: "— todos los servidores en ejecución; herramientas nombradas {pattern}",
  perServerLabel: "Por servidor",
  perServerDesc: "— un backend, nombres originales de herramientas",
  authLabel: "Autenticación",
  authEnabledDesc:
    "— OAuth cuando el cliente lo admite, o {bearer} desde claves API. Los tokens de sesión ({session}) son solo de la IU.",
  authDisabledDesc:
    "— desactivada en este host ({flag}); no hace falta Bearer",
  docs: "Docs:",
  authStep:
    "Auth: preferir OAuth (el cliente abre un navegador; inicias sesión y pulsas Allow). O usa una clave API — Authorization: Bearer {token} desde claves API (clave de usuario o de inquilino para M2M). Los tokens de sesión mcs_… son solo de la IU de administración.",
  authDisabledStep:
    "La autenticación está desactivada en este host — no hace falta cabecera Bearer.",
  oauthNote:
    "Si el cliente admite MCP OAuth, añade solo la URL — descubrirá /.well-known/oauth-protected-resource y abrirá un navegador para iniciar sesión.",
  platforms: {
    oauth: {
      name: "OAuth (inicio de sesión en el navegador)",
      blurb:
        "Los clientes que admiten MCP OAuth abren un navegador para que inicies sesión con tu cuenta. El acceso a herramientas usa tus permisos de usuario. Las claves API de inquilino siguen siendo lo mejor para máquina a máquina.",
      steps: [
        "Añade solo la URL de la puerta de enlace (sin clave API estática) en un cliente que admita MCP OAuth remoto.",
        "En la primera conexión el cliente descubre /.well-known/oauth-protected-resource, se registra y abre /oauth/authorize.",
        "Inicia sesión (contraseña o SSO) y pulsa Allow — el cliente recibe un token de acceso (mca_…) para tus permisos.",
        "Para automatización / servicios compartidos, usa una clave API de inquilino (ver claves API).",
      ],
      snippetUrlOnly: "Config solo URL (clientes OAuth)",
      snippetDiscovery: "Endpoints de descubrimiento",
    },
    claudeDesktop: {
      name: "Claude Desktop",
      blurb: "Apunta Claude Desktop a la puerta de enlace Streamable HTTP.",
      steps: [
        "Abre Claude Desktop → Settings → Developer → Edit Config.",
        "Fusiona el bloque mcpServers en claude_desktop_config.json.",
        "Reinicia Claude Desktop.",
      ],
      snippetOauth: "mcpServers (OAuth — solo URL)",
      snippetApiKey: "claude_desktop_config.json (clave API)",
    },
    cursor: {
      name: "Cursor",
      blurb: "Añade la puerta de enlace como servidor MCP en los ajustes de Cursor.",
      steps: [
        "Cursor Settings → MCP → Add new global MCP server (o edita mcp.json).",
        "Usa el formulario type/url si está disponible; si no, pega el JSON de abajo.",
        "Recarga los servidores MCP / reinicia Cursor si no aparecen las herramientas.",
      ],
      snippetOauth: "mcp.json (OAuth — solo URL)",
      snippetApiKey: "mcp.json (clave API de respaldo)",
    },
    vscode: {
      name: "VS Code / Copilot",
      blurb: "Configura un servidor MCP HTTP en los ajustes MCP de VS Code.",
      steps: [
        "Command Palette → “MCP: Open User Configuration” (o mcp.json del espacio de trabajo).",
        "Añade la entrada servers de abajo (VS Code 1.99+ HTTP MCP).",
        "Inicia el servidor desde la vista MCP si no se conecta solo.",
      ],
      snippet: "mcp.json",
    },
    claudeCode: {
      name: "Claude Code",
      blurb: "Registra la puerta de enlace HTTP con la CLI de Claude Code.",
      steps: [
        "Ejecuta el comando de abajo en una terminal donde esté instalado claude.",
        "Verifica con claude mcp list.",
      ],
      snippet: "CLI",
    },
    windsurf: {
      name: "Windsurf",
      blurb: "Configuración Cascade MCP con una URL de servidor remoto.",
      steps: [
        "Abre los ajustes MCP de Windsurf / mcp_config.json.",
        "Añade la entrada serverUrl y recarga Cascade.",
      ],
      snippet: "mcp_config.json",
    },
    continue: {
      name: "Continue",
      blurb: "Configuración de Continue.dev para un servidor MCP HTTP streamable.",
      steps: [
        "Edita ~/.continue/config.yaml o la sección JSON MCP que use tu versión de Continue.",
        "Añade el servidor streamable-http y recarga la extensión.",
      ],
      snippet: "Entrada de servidor MCP",
    },
    bifrost: {
      name: "Bifrost",
      blurb:
        "Añade la puerta de enlace unificada, o un cliente Bifrost por /mcp/{'<'}serverId{'>'} para una organización upstream más clara.",
      steps: [
        "En Bifrost: MCP Gateway → New MCP Server (o Clients).",
        "Tipo de conexión: HTTP (Streamable HTTP).",
        "Para todo: URL de conexión = /mcp unificado de abajo.",
        "Para un backend: URL de conexión = /mcp/{'<'}serverId{'>'} (p. ej. …/mcp/portainer) — las herramientas conservan nombres originales.",
        "Si Bifrost corre en otro host, usa una dirección alcanzable de MCP Hoster.",
      ],
      authHeaders:
        "Tipo de auth: Headers — Authorization: Bearer {token} (genera la clave en claves API).",
      authNone: "Tipo de auth: none (la auth del host está desactivada).",
      snippetJson: "JSON de cliente Bifrost (/mcp unificado)",
      snippetApi: "Ejemplo de API Bifrost (ajusta host/puerto de Bifrost)",
    },
    generic: {
      name: "HTTP genérico / curl",
      blurb:
        "Cualquier cliente MCP Streamable HTTP puede hacer POST JSON-RPC a la puerta de enlace.",
      steps: [
        "Transporte: Streamable HTTP.",
        "Endpoint: POST (y GET para SSE cuando haga falta) en la URL de la puerta de enlace.",
        "Accept: application/json, text/event-stream.",
        "Las herramientas usan espacio de nombres {serverId}__{toolName}.",
      ],
      snippet: "tools/list",
    },
  },
} as const;
