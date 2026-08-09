import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ProcessManager } from "../process_manager.ts";
import { allowsServer, allowsTool, type ScopeGrant } from "../auth/scopes.ts";

const NS = "__";
const RESOURCE_URI_PREFIX = "mcp-hoster://";

export type GatewayMode = {
  /** When set, only expose this backend. Tools keep their original names. */
  serverId?: string;
  /** When set, only tools allowed by these grants are exposed. */
  scopes?: ScopeGrant[] | null;
};

export function parseNamespacedTool(name: string): { serverId: string; toolName: string } | null {
  const idx = name.indexOf(NS);
  if (idx <= 0) return null;
  return {
    serverId: name.slice(0, idx),
    toolName: name.slice(idx + NS.length),
  };
}

export function parseNamespacedResourceUri(
  uri: string,
): { serverId: string; backendUri: string } | null {
  if (!uri.startsWith(RESOURCE_URI_PREFIX)) return null;
  const rest = uri.slice(RESOURCE_URI_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const serverId = rest.slice(0, slash);
  try {
    return {
      serverId,
      backendUri: decodeURIComponent(rest.slice(slash + 1)),
    };
  } catch {
    return null;
  }
}

function promptArgsSchema(
  args: Array<{ name: string; description?: string; required?: boolean }> | undefined,
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const arg of args ?? []) {
    let field = z.string();
    if (arg.description) field = field.describe(arg.description);
    shape[arg.name] = arg.required ? field : field.optional();
  }
  return Object.keys(shape).length ? shape : undefined;
}

export function createGatewayHandler(pm: ProcessManager, mode: GatewayMode = {}) {
  const scopedId = mode.serverId;
  const scopes = mode.scopes ?? null;

  return createMcpHandler(async () => {
    const server = new McpServer({
      name: scopedId ? `mcp-hoster/${scopedId}` : "mcp-hoster",
      version: "0.1.0",
    });

    const candidates = scopedId
      ? pm.getTools(scopedId).map((t) => ({
        ...t,
        serverId: scopedId,
        // Dedicated endpoints expose original tool names (path provides the scope).
        exposeName: t.name,
        description: t.description ?? `Tool ${t.name} from ${scopedId}`,
      }))
      : pm.getAllTools().map((t) => ({
        ...t,
        exposeName: t.namespacedName,
        description: t.description
          ? `[${t.serverId}] ${t.description}`
          : `Tool ${t.name} from ${t.serverId}`,
      }));
    const tools = [];
    for (const t of candidates) {
      if (await pm.isToolDisabled(t.serverId, t.name)) continue;
      if (scopes && !allowsTool(scopes, t.serverId, t.name)) continue;
      tools.push(t);
    }

    for (const tool of tools) {
      const inputSchema = fromJsonSchema(
        tool.inputSchema?.type
          ? tool.inputSchema
          : { type: "object", properties: {} },
      );

      const register = server.registerTool.bind(server) as (
        name: string,
        config: {
          description?: string;
          inputSchema: typeof inputSchema;
        },
        cb: (
          args: Record<string, unknown>,
        ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>,
      ) => void;

      register(
        tool.exposeName,
        {
          description: tool.description,
          inputSchema,
        },
        async (args) => {
          if (await pm.isToolDisabled(tool.serverId, tool.name)) {
            return {
              content: [{
                type: "text",
                text: `Tool disabled on server: ${tool.exposeName}`,
              }],
              isError: true,
            };
          }
          if (scopes && !allowsTool(scopes, tool.serverId, tool.name)) {
            return {
              content: [{ type: "text", text: `Tool not permitted: ${tool.exposeName}` }],
              isError: true,
            };
          }

          const backend = pm.getBackend(tool.serverId);
          if (!backend) {
            return {
              content: [{
                type: "text",
                text: `Backend ${tool.serverId} is not running`,
              }],
              isError: true,
            };
          }

          const result = await backend.client.callTool({
            name: tool.name,
            arguments: args ?? {},
          });

          return {
            content: (result.content ?? []) as Array<{ type: "text"; text: string }>,
            isError: Boolean(result.isError),
          };
        },
      );
    }

    const resources = (scopedId
      ? pm.getResources(scopedId).map((r) => ({
        ...r,
        serverId: scopedId,
        exposeUri: r.uri,
        exposeName: r.name,
        description: r.description ?? `Resource ${r.name} from ${scopedId}`,
      }))
      : pm.getAllResources().map((r) => ({
        ...r,
        exposeUri: r.namespacedUri,
        exposeName: r.namespacedName,
        description: r.description
          ? `[${r.serverId}] ${r.description}`
          : `Resource ${r.name} from ${r.serverId}`,
      }))).filter((r) => !scopes || allowsServer(scopes, r.serverId));

    for (const resource of resources) {
      server.registerResource(
        resource.exposeName,
        resource.exposeUri,
        {
          description: resource.description,
          mimeType: resource.mimeType,
        },
        async (uri) => {
          if (scopes && !allowsServer(scopes, resource.serverId)) {
            throw new Error(`Resource not permitted: ${resource.exposeUri}`);
          }
          const backend = pm.getBackend(resource.serverId);
          if (!backend) {
            throw new Error(`Backend ${resource.serverId} is not running`);
          }
          const backendUri = scopedId
            ? String(uri)
            : (parseNamespacedResourceUri(String(uri))?.backendUri ?? resource.uri);
          return await backend.client.readResource({ uri: backendUri });
        },
      );
    }

    const prompts = (scopedId
      ? pm.getPrompts(scopedId).map((p) => ({
        ...p,
        serverId: scopedId,
        exposeName: p.name,
        description: p.description ?? `Prompt ${p.name} from ${scopedId}`,
      }))
      : pm.getAllPrompts().map((p) => ({
        ...p,
        exposeName: p.namespacedName,
        description: p.description
          ? `[${p.serverId}] ${p.description}`
          : `Prompt ${p.name} from ${p.serverId}`,
      }))).filter((p) => !scopes || allowsServer(scopes, p.serverId));

    for (const prompt of prompts) {
      const argShape = promptArgsSchema(prompt.arguments);
      server.registerPrompt(
        prompt.exposeName,
        {
          description: prompt.description,
          ...(argShape ? { argsSchema: z.object(argShape) } : {}),
        },
        async (args) => {
          if (scopes && !allowsServer(scopes, prompt.serverId)) {
            throw new Error(`Prompt not permitted: ${prompt.exposeName}`);
          }
          const backend = pm.getBackend(prompt.serverId);
          if (!backend) {
            throw new Error(`Backend ${prompt.serverId} is not running`);
          }
          return await backend.client.getPrompt({
            name: prompt.name,
            arguments: (args ?? {}) as Record<string, string>,
          });
        },
      );
    }

    return server;
  });
}
