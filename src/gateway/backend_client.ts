import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ServerRecord } from "../db/types.ts";
import type { PreparedSandbox } from "../sandbox.ts";
import { appendLog } from "../sandbox.ts";
import {
  type SandboxRuntime,
  wrapSandboxCommand,
} from "../sandbox_wrap.ts";

export type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type DiscoveredResource = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type DiscoveredPrompt = {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
};

export type BackendHandle = {
  serverId: string;
  client: Client;
  transport: StdioClientTransport;
  tools: DiscoveredTool[];
  resources: DiscoveredResource[];
  prompts: DiscoveredPrompt[];
  pid: number | null;
};

export async function connectBackend(
  server: ServerRecord,
  sandbox: PreparedSandbox,
  sandboxRuntime: SandboxRuntime,
): Promise<BackendHandle> {
  const wrapped = await wrapSandboxCommand(
    sandboxRuntime,
    sandbox,
    server.command,
    server.args,
  );

  const transport = new StdioClientTransport({
    command: wrapped.command,
    args: wrapped.args,
    cwd: sandbox.cwd,
    env: sandbox.env,
    stderr: "pipe",
  });

  const stderr = transport.stderr;
  if (stderr) {
    stderr.on("data", (buf: Buffer | string) => {
      const text = typeof buf === "string" ? buf : buf.toString("utf8");
      void appendLog(sandbox.logPath, text);
    });
  }

  const client = new Client({ name: "mcp-hoster", version: "0.1.0" });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: DiscoveredTool[] = (listed.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<
      string,
      unknown
    >,
  }));

  let resources: DiscoveredResource[] = [];
  try {
    const listedResources = await client.listResources();
    resources = (listedResources.resources ?? []).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  } catch {
    resources = [];
  }

  let prompts: DiscoveredPrompt[] = [];
  try {
    const listedPrompts = await client.listPrompts();
    prompts = (listedPrompts.prompts ?? []).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments?.map((a) => ({
        name: a.name,
        description: a.description,
        required: a.required,
      })),
    }));
  } catch {
    prompts = [];
  }

  await appendLog(
    sandbox.logPath,
    `\n[${new Date().toISOString()}] connected; ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts (sandbox=${sandboxRuntime.mode})\n`,
  );

  return {
    serverId: server.id,
    client,
    transport,
    tools,
    resources,
    prompts,
    pid: transport.pid,
  };
}

export async function disconnectBackend(handle: BackendHandle): Promise<void> {
  try {
    await handle.client.close();
  } catch {
    try {
      await handle.transport.close();
    } catch {
      // ignore
    }
  }
}
