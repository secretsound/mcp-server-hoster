import { adminBus } from "./admin/bus.ts";
import type { BootstrapConfig } from "./config.ts";
import type { ServerRepository } from "./db/repos/servers.ts";
import type {
  CreateServerInput,
  ServerWithRuntime,
  UpdateServerInput,
  UpgradeServerInput,
} from "./db/types.ts";
import { applyPackageVersion, extractPackageSpec } from "./package_spec.ts";
import type { ProcessManager } from "./process_manager.ts";
import { clearPackageCaches } from "./sandbox.ts";
import { join } from "@std/path";

export class ServerRegistry {
  constructor(
    readonly config: BootstrapConfig,
    readonly servers: ServerRepository,
    readonly pm: ProcessManager,
  ) {
    this.pm.onChange(() => adminBus.emit({ type: "servers" }));
  }

  async list(): Promise<Array<ServerWithRuntime & { toolCount: number }>> {
    return (await this.servers.list()).map((s) => ({
      ...s,
      toolCount: this.enabledToolCount(s),
      runtime: {
        ...s.runtime,
        lastStatus: this.pm.isRunning(s.id) ? "running" : s.runtime.lastStatus,
        pid: this.pm.getBackend(s.id)?.pid ?? s.runtime.pid,
      },
    }));
  }

  async get(id: string) {
    const s = await this.servers.get(id);
    if (!s) return null;
    return {
      ...s,
      toolCount: this.enabledToolCount(s),
      runtime: {
        ...s.runtime,
        lastStatus: this.pm.isRunning(s.id) ? "running" as const : s.runtime.lastStatus,
        pid: this.pm.getBackend(s.id)?.pid ?? s.runtime.pid,
      },
    };
  }

  private enabledToolCount(s: ServerWithRuntime): number {
    return this.pm.getTools(s.id).filter((t) => !s.disabledTools.includes(t.name))
      .length;
  }

  async create(input: CreateServerInput) {
    const created = await this.servers.create(input);
    if (created.enabled) {
      // Don't block the install response on package download / MCP handshake.
      void this.pm.start(created.id).catch((err) => {
        console.error(`[registry] auto-start failed for ${created.id}:`, err);
      });
    } else {
      adminBus.emit({ type: "servers" });
    }
    return (await this.get(created.id))!;
  }

  async update(id: string, input: UpdateServerInput) {
    const wasRunning = this.pm.isRunning(id);
    const updated = await this.servers.update(id, input);
    const configChanged = [
      input.command,
      input.args,
      input.env,
      input.source,
      input.cwd,
    ].some((v) => v !== undefined);

    try {
      if (input.enabled === false && wasRunning) {
        await this.pm.stop(id);
      } else if (input.enabled === true && !wasRunning) {
        await this.pm.start(id);
      } else if (wasRunning && configChanged) {
        await this.pm.restart(id);
      } else {
        adminBus.emit({ type: "servers" });
      }
    } catch (err) {
      console.error(`[registry] lifecycle update failed for ${id}:`, err);
      adminBus.emit({ type: "servers" });
    }
    return (await this.get(updated.id))!;
  }

  async delete(id: string) {
    if (this.pm.isRunning(id)) await this.pm.stop(id);
    await this.servers.delete(id);
    adminBus.emit({ type: "servers" });
  }

  async upgrade(id: string, input: UpgradeServerInput = {}) {
    const existing = await this.servers.get(id);
    if (!existing) throw new Error(`Server not found: ${id}`);

    const previousVersion = existing.packageVersion ??
      extractPackageSpec(existing).version;
    const version = input.version === undefined
      ? null
      : (input.version?.trim() || null);
    const next = applyPackageVersion(
      {
        command: existing.command,
        args: existing.args,
        source: existing.source,
      },
      version,
    );

    if (input.clearCache !== false) {
      const workDir = join(this.config.serversDir, id);
      await clearPackageCaches(workDir);
    }

    const updated = await this.servers.update(id, {
      command: next.command,
      args: next.args,
      source: next.source,
      packageName: next.name,
      packageVersion: next.version,
      lastUpgradedAt: new Date().toISOString(),
    });

    const wasRunning = this.pm.isRunning(id) ||
      updated.runtime.desiredState === "running";
    try {
      if (wasRunning) {
        if (this.pm.isRunning(id)) await this.pm.restart(id);
        else await this.pm.start(id);
      } else {
        adminBus.emit({ type: "servers" });
      }
    } catch (err) {
      console.error(`[registry] upgrade restart failed for ${id}:`, err);
      adminBus.emit({ type: "servers" });
    }

    return {
      server: (await this.get(id))!,
      upgrade: {
        kind: next.kind,
        name: next.name,
        version: next.version,
        previousVersion,
        clearedCache: input.clearCache !== false,
        label: next.version
          ? `${next.name}@${next.version}`
          : `${next.name} (latest)`,
      },
    };
  }
}
