import type { BootstrapConfig } from "./config.ts";
import type { ServerRepository } from "./db/repos/servers.ts";
import {
  connectBackend,
  disconnectBackend,
  type BackendHandle,
  type DiscoveredPrompt,
  type DiscoveredResource,
  type DiscoveredTool,
} from "./gateway/backend_client.ts";
import { prepareSandbox, readLogTail } from "./sandbox.ts";
import type { SandboxController } from "./sandbox_wrap.ts";

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

type Managed = {
  handle: BackendHandle;
  restarts: number[];
};

export type ProcessAuditEvent = {
  action: string;
  serverId: string;
  summary: string;
  metadata?: Record<string, unknown>;
};

export class ProcessManager {
  private readonly running = new Map<string, Managed>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly config: BootstrapConfig,
    private readonly servers: ServerRepository,
    private readonly sandbox: SandboxController,
    private readonly onAudit?: (event: ProcessAuditEvent) => void,
  ) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  getTools(serverId: string): DiscoveredTool[] {
    return this.running.get(serverId)?.handle.tools ?? [];
  }

  /** Operator denylist — original backend tool names. */
  async isToolDisabled(serverId: string, toolName: string): Promise<boolean> {
    const record = await this.servers.get(serverId);
    return Boolean(record?.disabledTools.includes(toolName));
  }

  getAllTools(): Array<DiscoveredTool & { serverId: string; namespacedName: string }> {
    const out: Array<DiscoveredTool & { serverId: string; namespacedName: string }> = [];
    for (const [serverId, managed] of this.running) {
      for (const tool of managed.handle.tools) {
        out.push({
          ...tool,
          serverId,
          namespacedName: `${serverId}__${tool.name}`,
        });
      }
    }
    return out;
  }

  getResources(serverId: string): DiscoveredResource[] {
    return this.running.get(serverId)?.handle.resources ?? [];
  }

  getAllResources(): Array<
    DiscoveredResource & { serverId: string; namespacedUri: string; namespacedName: string }
  > {
    const out: Array<
      DiscoveredResource & { serverId: string; namespacedUri: string; namespacedName: string }
    > = [];
    for (const [serverId, managed] of this.running) {
      for (const resource of managed.handle.resources) {
        out.push({
          ...resource,
          serverId,
          namespacedUri: `mcp-hoster://${serverId}/${encodeURIComponent(resource.uri)}`,
          namespacedName: `${serverId}__${resource.name}`,
        });
      }
    }
    return out;
  }

  getPrompts(serverId: string): DiscoveredPrompt[] {
    return this.running.get(serverId)?.handle.prompts ?? [];
  }

  getAllPrompts(): Array<DiscoveredPrompt & { serverId: string; namespacedName: string }> {
    const out: Array<DiscoveredPrompt & { serverId: string; namespacedName: string }> = [];
    for (const [serverId, managed] of this.running) {
      for (const prompt of managed.handle.prompts) {
        out.push({
          ...prompt,
          serverId,
          namespacedName: `${serverId}__${prompt.name}`,
        });
      }
    }
    return out;
  }

  getBackend(serverId: string): BackendHandle | undefined {
    return this.running.get(serverId)?.handle;
  }

  isRunning(serverId: string): boolean {
    return this.running.has(serverId);
  }

  async start(serverId: string): Promise<void> {
    if (this.running.has(serverId)) return;

    const record = await this.servers.get(serverId);
    if (!record) throw new Error(`Server not found: ${serverId}`);

    await this.servers.setRuntime(serverId, {
      desiredState: "running",
      lastStatus: "starting",
      lastError: null,
      pid: null,
    });
    this.emit();

    try {
      const sandbox = await prepareSandbox(this.config, record);
      const handle = await connectBackend(
        record,
        sandbox,
        this.sandbox.getRuntime(),
      );
      this.running.set(serverId, { handle, restarts: [] });

      handle.transport.onclose = () => {
        void this.onProcessExit(serverId);
      };

      await this.servers.setRuntime(serverId, {
        desiredState: "running",
        lastStatus: "running",
        lastError: null,
        pid: handle.pid,
        lastStartedAt: new Date().toISOString(),
      });
      this.emit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.servers.setRuntime(serverId, {
        desiredState: "running",
        lastStatus: "error",
        lastError: message,
        pid: null,
        lastCrashAt: new Date().toISOString(),
      });
      this.emit();
      throw err;
    }
  }

  async stop(serverId: string): Promise<void> {
    await this.servers.setRuntime(serverId, {
      desiredState: "stopped",
      lastStatus: "stopped",
      lastError: null,
      pid: null,
    });

    const managed = this.running.get(serverId);
    if (!managed) {
      this.emit();
      return;
    }

    this.running.delete(serverId);
    await disconnectBackend(managed.handle);
    this.emit();
  }

  async restart(serverId: string): Promise<void> {
    await this.servers.setRuntime(serverId, { lastStatus: "restarting" });
    this.emit();
    await this.stop(serverId);
    await this.start(serverId);
  }

  async startEnabled(): Promise<void> {
    for (const server of await this.servers.list()) {
      if (server.enabled || server.runtime.desiredState === "running") {
        try {
          await this.start(server.id);
        } catch (err) {
          console.error(`[pm] failed to start ${server.id}:`, err);
        }
      }
    }
  }

  async stopAll(): Promise<void> {
    const ids = [...this.running.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  async logs(serverId: string, tail = 200): Promise<string> {
    const path = `${this.config.logsDir}/${serverId}.log`;
    return await readLogTail(path, tail);
  }

  private async onProcessExit(serverId: string): Promise<void> {
    const managed = this.running.get(serverId);
    if (!managed) return;
    this.running.delete(serverId);

    const record = await this.servers.get(serverId);
    if (!record || record.runtime.desiredState !== "running") {
      await this.servers.setRuntime(serverId, {
        lastStatus: "stopped",
        pid: null,
      });
      this.emit();
      return;
    }

    const now = Date.now();
    managed.restarts = managed.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    const prior = await this.servers.get(serverId);
    const nextRestartCount = (prior?.runtime.restartCount ?? 0) + 1;

    if (managed.restarts.length >= MAX_RESTARTS) {
      const lastError =
        `Exceeded ${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS}ms`;
      await this.servers.setRuntime(serverId, {
        lastStatus: "error",
        lastError,
        pid: null,
        restartCount: nextRestartCount,
        lastCrashAt: new Date().toISOString(),
      });
      this.onAudit?.({
        action: "server.crash",
        serverId,
        summary: `Server ${serverId} crashed after restart storm`,
        metadata: {
          maxRestarts: MAX_RESTARTS,
          windowMs: RESTART_WINDOW_MS,
          lastError,
          restartCount: nextRestartCount,
        },
      });
      this.emit();
      return;
    }

    managed.restarts.push(now);
    await this.servers.setRuntime(serverId, {
      lastStatus: "restarting",
      lastError: null,
      pid: null,
      restartCount: nextRestartCount,
    });
    this.emit();

    const delay = Math.min(1000 * 2 ** managed.restarts.length, 15_000);
    await new Promise((r) => setTimeout(r, delay));

    const latest = await this.servers.get(serverId);
    if (latest?.runtime.desiredState === "running" && !this.running.has(serverId)) {
      try {
        await this.start(serverId);
      } catch (err) {
        console.error(`[pm] restart failed for ${serverId}:`, err);
      }
    }
  }

}
