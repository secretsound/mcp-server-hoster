import type { BootstrapConfig, HostBootstrapFile } from "../config.ts";
import { writeHostBootstrap } from "../config.ts";
import type { SettingsRepository } from "../db/repos/settings.ts";
import {
  parseSandboxMode,
  SANDBOX_MODE_SETTING_KEY,
} from "../sandbox_wrap.ts";

export type SettingType = "string" | "number" | "boolean";

export type SettingDef = {
  key: string;
  type: SettingType;
  default: string;
  restartRequired: boolean;
  /** Stored in host.json when changed (bootstrap / pre-DB). */
  bootstrapField?: keyof HostBootstrapFile;
  sensitive?: boolean;
  description: string;
};

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "host.display_name",
    type: "string",
    default: "MCP Hoster",
    restartRequired: false,
    description: "Product name shown in the admin UI",
  },
  {
    key: "host.notes",
    type: "string",
    default: "",
    restartRequired: false,
    description: "Free-form admin notes",
  },
  {
    key: SANDBOX_MODE_SETTING_KEY,
    type: "string",
    default: "auto",
    restartRequired: false,
    description: "Process sandbox backend",
  },
  {
    key: "host.gateway_public_url",
    type: "string",
    default: "",
    restartRequired: false,
    bootstrapField: "gatewayPublicUrl",
    description: "Public /mcp URL advertised to clients",
  },
  {
    key: "host.public_url",
    type: "string",
    default: "",
    restartRequired: false,
    bootstrapField: "publicUrl",
    description: "Public origin for OAuth redirects",
  },
  {
    key: "host.auth_disabled",
    type: "boolean",
    default: "false",
    restartRequired: true,
    bootstrapField: "authDisabled",
    description: "Disable auth enforcement (dangerous)",
  },
  {
    key: "host.auth_allow_open",
    type: "boolean",
    default: "false",
    restartRequired: true,
    bootstrapField: "authAllowOpen",
    description: "Allow open access until the first user exists",
  },
  {
    key: "host.bind",
    type: "string",
    default: "0.0.0.0",
    restartRequired: true,
    bootstrapField: "bind",
    description: "Listen bind address",
  },
  {
    key: "host.port",
    type: "number",
    default: "8080",
    restartRequired: true,
    bootstrapField: "port",
    description: "Listen port",
  },
  {
    key: "host.data_dir",
    type: "string",
    default: "./data",
    restartRequired: true,
    bootstrapField: "dataDir",
    description: "Host data directory",
  },
  {
    key: "host.database_url",
    type: "string",
    default: "",
    restartRequired: true,
    bootstrapField: "databaseUrl",
    sensitive: true,
    description: "Database URL (sqlite:// or postgres://)",
  },
  {
    key: "ui.default_log_tail",
    type: "number",
    default: "200",
    restartRequired: false,
    description: "Default log lines to load in the UI",
  },
];

const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

export function getSettingDef(key: string): SettingDef | undefined {
  return DEF_BY_KEY.get(key);
}

export function validateSettingValue(key: string, value: string): string {
  const def = DEF_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);

  if (key === SANDBOX_MODE_SETTING_KEY) {
    const mode = parseSandboxMode(value);
    if (value.trim().toLowerCase() !== mode) {
      throw new Error("host.sandbox_mode must be auto, bwrap, landlock, or none");
    }
    return mode;
  }

  if (def.type === "boolean") {
    const v = value.trim().toLowerCase();
    if (!["true", "false", "1", "0", "yes", "no"].includes(v)) {
      throw new Error(`${key} must be a boolean`);
    }
    return ["1", "true", "yes"].includes(v) ? "true" : "false";
  }

  if (def.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    if (key === "host.port") {
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new Error("host.port must be an integer 1–65535");
      }
    }
    if (key === "ui.default_log_tail") {
      if (!Number.isInteger(n) || n < 50 || n > 5000) {
        throw new Error("ui.default_log_tail must be an integer 50–5000");
      }
    }
    return String(Math.trunc(n));
  }

  if (key === "host.database_url" && value.trim()) {
    const v = value.trim();
    if (
      !v.startsWith("sqlite:") &&
      !v.startsWith("postgres://") &&
      !v.startsWith("postgresql://")
    ) {
      throw new Error("host.database_url must be sqlite: or postgres(ql):");
    }
    return v;
  }

  if (key === "host.gateway_public_url" && value.trim()) {
    const noSlash = value.trim().replace(/\/$/, "");
    return noSlash.endsWith("/mcp") ? noSlash : `${noSlash}/mcp`;
  }

  if (key === "host.public_url" && value.trim()) {
    return value.trim().replace(/\/$/, "");
  }

  return value;
}

function boolStr(v: boolean): string {
  return v ? "true" : "false";
}

/** Seed missing settings keys from the live bootstrap config. */
export async function seedSettingsFromBootstrap(
  settings: SettingsRepository,
  config: BootstrapConfig,
): Promise<void> {
  const defaults: Record<string, string> = {
    "host.display_name": "MCP Hoster",
    "host.notes": "",
    [SANDBOX_MODE_SETTING_KEY]: "auto",
    "host.gateway_public_url": config.gatewayPublicUrl ?? "",
    "host.public_url": config.publicUrl ?? "",
    "host.auth_disabled": boolStr(config.authDisabled),
    "host.auth_allow_open": boolStr(config.authAllowOpen),
    "host.bind": config.bind,
    "host.port": String(config.port),
    "host.data_dir": config.dataDir,
    "host.database_url": config.databaseUrl,
    "ui.default_log_tail": "200",
  };

  for (const [key, value] of Object.entries(defaults)) {
    if ((await settings.get(key)) == null) {
      await settings.set(key, value);
    }
  }
}

export type ApplySettingsResult = {
  settings: Record<string, string>;
  restartRequired: boolean;
  pendingBootstrap: HostBootstrapFile;
  sandboxModeChanged: string | null;
};

function bootstrapValueFromSetting(
  def: SettingDef,
  value: string,
): string | number | boolean | null {
  if (def.type === "boolean") return value === "true";
  if (def.type === "number") return Number(value);
  if (def.bootstrapField === "gatewayPublicUrl" || def.bootstrapField === "publicUrl") {
    return value.trim() ? value : null;
  }
  return value;
}

/** Apply allowlisted settings; write restart-required keys to host.json. */
export async function applySettingsUpdate(
  settings: SettingsRepository,
  config: BootstrapConfig,
  body: Record<string, unknown>,
): Promise<ApplySettingsResult> {
  const bootstrapPatch: HostBootstrapFile = {};
  let restartRequired = false;
  let sandboxModeChanged: string | null = null;

  for (const [key, raw] of Object.entries(body)) {
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      continue;
    }
    const def = getSettingDef(key);
    if (!def) {
      throw new Error(`Unknown setting: ${key}`);
    }
    const asString = typeof raw === "string" ? raw : String(raw);
    const value = validateSettingValue(key, asString);
    await settings.set(key, value);

    if (key === SANDBOX_MODE_SETTING_KEY) {
      sandboxModeChanged = value;
    }

    if (def.restartRequired) {
      restartRequired = true;
      if (def.bootstrapField) {
        (bootstrapPatch as Record<string, unknown>)[def.bootstrapField] =
          bootstrapValueFromSetting(def, value);
      }
    } else if (def.bootstrapField) {
      // Keep host.json in sync for URLs even when hot-applied
      (bootstrapPatch as Record<string, unknown>)[def.bootstrapField] =
        bootstrapValueFromSetting(def, value);
    }
  }

  let pendingBootstrap = { ...config.hostFile };
  if (Object.keys(bootstrapPatch).length > 0) {
    const path = await writeHostBootstrap(config.dataDir, bootstrapPatch);
    pendingBootstrap = {
      ...config.hostFile,
      ...bootstrapPatch,
    };
    void path;
  }

  return {
    settings: await settings.getAll(),
    restartRequired,
    pendingBootstrap,
    sandboxModeChanged,
  };
}

export function pendingBootstrapDiff(
  config: BootstrapConfig,
): { pending: boolean; live: Record<string, string>; file: Record<string, string> } {
  const file = config.hostFile;
  const live: Record<string, string> = {
    databaseUrl: config.databaseUrl,
    bind: config.bind,
    port: String(config.port),
    dataDir: config.dataDir,
  };
  const fileView: Record<string, string> = {
    databaseUrl: file.databaseUrl ?? config.databaseUrl,
    bind: file.bind ?? config.bind,
    port: String(file.port ?? config.port),
    dataDir: file.dataDir ?? config.dataDir,
  };
  const pending =
    live.databaseUrl !== fileView.databaseUrl ||
    live.bind !== fileView.bind ||
    live.port !== fileView.port ||
    live.dataDir !== fileView.dataDir;
  return { pending, live, file: fileView };
}
