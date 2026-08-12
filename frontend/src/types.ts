export type DesiredState = "running" | "stopped";
export type RuntimeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "restarting";

export type ServerSource = {
  git: string;
  ref?: string;
} | null;

export type ServerRuntime = {
  serverId: string;
  desiredState: DesiredState;
  lastStatus: RuntimeStatus;
  lastError: string | null;
  pid: number | null;
  restartCount?: number;
  lastStartedAt?: string | null;
  lastCrashAt?: string | null;
  updatedAt: string;
};

export type ServerRecord = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  source: ServerSource;
  enabled: boolean;
  packageName?: string | null;
  packageVersion?: string | null;
  lastUpgradedAt?: string | null;
  /** Original tool names hidden from MCP clients. */
  disabledTools?: string[];
  createdAt: string;
  updatedAt: string;
};

export type ServerWithRuntime = ServerRecord & {
  runtime: ServerRuntime;
  toolCount?: number;
};

export type CreateServerInput = {
  id: string;
  name?: string;
  transport?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  source?: ServerSource;
  enabled?: boolean;
  packageName?: string | null;
  packageVersion?: string | null;
};

export type UpdateServerInput = {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  source?: ServerSource;
  enabled?: boolean;
  packageName?: string | null;
  packageVersion?: string | null;
  disabledTools?: string[];
};

export type UpgradeServerInput = {
  /** Target pin; omit or empty for latest/floating. */
  version?: string | null;
  /** Clear npx/uv caches in the sandbox before restart (default true). */
  clearCache?: boolean;
};

export type ToolInfo = {
  name: string;
  namespacedName: string;
  description?: string;
  inputSchema?: unknown;
  /** False when the operator disabled this tool on the server. */
  enabled?: boolean;
};

export type HealthCheck = {
  id: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message: string;
};

export type HealthResponse = {
  ok: boolean;
  bind?: string;
  port?: number;
  gateway: string;
  publicUrl?: string | null;
  database?: string;
  displayName?: string;
  sandbox?: string;
  sandboxRequested?: string;
  checks?: HealthCheck[];
  warnings?: string[];
  servers?: Array<{
    id: string;
    status: RuntimeStatus;
    desired: DesiredState;
    tools: number;
    pid: number | null;
    error: string | null;
    mcp: string;
  }>;
};

export type EnvPair = {
  key: string;
  value: string;
  /** When set, overrides placeholder/empty heuristics for install validation. */
  required?: boolean;
  /** Short hint shown under the env row in the install wizard. */
  description?: string;
  /** Render the value as a password field in the env editor. */
  secret?: boolean;
};

export type Launcher = "npx" | "uvx" | "custom";

export type ServerFormValues = {
  id: string;
  name: string;
  launcher: Launcher;
  /** Unpinned package name (version goes in packageVersion). */
  package?: string;
  /** Optional pin for npx/uvx; leave empty for latest. */
  packageVersion?: string;
  command?: string;
  extraArgs?: string;
  argsLines?: string;
  env: EnvPair[];
  git: string;
  ref: string;
  startNow: boolean;
};

export type LibraryCategoryId =
  | "essentials"
  | "apps"
  | "developer"
  | "web"
  | "utilities"
  | "reasoning"
  | string;

export type LibraryCategory = {
  id: LibraryCategoryId;
  label: string;
  description: string;
  sortOrder?: number;
};

export type LibraryItem = {
  id: string;
  name: string;
  blurb: string;
  tags: string[];
  source: string;
  category: LibraryCategoryId;
  featured?: boolean;
  sortOrder?: number;
  preset: ServerFormValues;
  createdAt?: string;
  updatedAt?: string;
};

/** @deprecated Use LibraryItem */
export type StoreItem = LibraryItem;

export type UserRole = string;

export type Permission = string;

export type ScopeGrant = {
  serverId: string;
  tools: string[];
};

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  role: UserRole;
  displayName: string | null;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  grants: ScopeGrant[];
  permissions: Permission[];
  hasPassword?: boolean;
};

export type RoleRecord = {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  createdAt: string;
};

export type PermissionInfo = {
  id: Permission;
  label: string;
  description: string;
};

export type InviteRecord = {
  id: string;
  tenantId: string;
  email: string;
  role: string;
  grants: ScopeGrant[];
  expiresAt: string;
  createdBy: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  token?: string;
};

export type ApiKeyOwnerType = "tenant" | "user";

export type ApiKey = {
  id: string;
  tenantId: string;
  ownerType: ApiKeyOwnerType;
  userId: string | null;
  name: string;
  keyPrefix: string;
  scopes: ScopeGrant[];
  createdBy: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type OAuthProvider = { id: string; label: string };

export type AuthStatus = {
  required: boolean;
  user: AuthUser | null;
  oauthProviders?: OAuthProvider[];
};

export type AuditEvent = {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
