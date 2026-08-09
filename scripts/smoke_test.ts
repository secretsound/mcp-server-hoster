/**
 * End-to-end smoke test against a running mcp-hoster instance.
 * Usage: deno task smoke
 */
const base = Deno.env.get("SMOKE_BASE_URL") ?? "http://127.0.0.1:8080";

async function waitForHealth(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        const body = await res.json();
        console.log("health:", body);
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("health check timed out");
}

async function main() {
  console.log(`smoke against ${base}`);
  await waitForHealth();

  const serversRes = await fetch(`${base}/api/servers`);
  if (!serversRes.ok) throw new Error(`list servers failed: ${serversRes.status}`);
  const { servers } = await serversRes.json();
  console.log(`servers: ${servers.length}`);

  // Ensure at least one server is running (seed "time" or start first)
  let running = servers.find((s: { runtime: { lastStatus: string } }) =>
    s.runtime.lastStatus === "running"
  );

  if (!running && servers[0]) {
    const id = servers[0].id;
    console.log(`starting ${id}...`);
    const startRes = await fetch(`${base}/api/servers/${id}/start`, { method: "POST" });
    const startBody = await startRes.json();
    if (!startRes.ok) throw new Error(`start failed: ${startBody.error}`);
    // wait for tools
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const h = await (await fetch(`${base}/health`)).json();
      const row = h.servers.find((s: { id: string }) => s.id === id);
      if (row?.status === "running" && row.tools > 0) {
        running = { id, toolCount: row.tools };
        break;
      }
      if (row?.status === "error") throw new Error(`server error: ${row.error}`);
    }
  }

  if (!running) throw new Error("no running server available for smoke test");

  const toolsRes = await fetch(`${base}/api/servers/${running.id}/tools`);
  const toolsBody = await toolsRes.json();
  if (!toolsRes.ok) throw new Error(toolsBody.error);
  console.log(`tools on ${running.id}:`, toolsBody.tools.map((t: { namespacedName: string }) => t.namespacedName));

  // MCP tools/list via Streamable HTTP
  const mcpRes = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  const contentType = mcpRes.headers.get("content-type") ?? "";
  const text = await mcpRes.text();
  console.log(`mcp tools/list status=${mcpRes.status} content-type=${contentType}`);
  if (!mcpRes.ok) throw new Error(`mcp tools/list failed: ${text}`);

  let toolNames: string[] = [];
  if (contentType.includes("text/event-stream") || text.includes("event:")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = JSON.parse(line.slice(5).trim());
      toolNames = (payload.result?.tools ?? []).map((t: { name: string }) => t.name);
    }
  } else {
    const payload = JSON.parse(text);
    toolNames = (payload.result?.tools ?? []).map((t: { name: string }) => t.name);
  }

  console.log(`gateway tools (${toolNames.length}):`, toolNames.slice(0, 20));
  if (toolNames.length === 0) {
    throw new Error("gateway returned zero tools");
  }

  const namespaced = toolNames.some((n) => n.includes("__"));
  if (!namespaced) {
    throw new Error("expected namespaced tool names like serverId__tool");
  }

  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  Deno.exit(1);
});
