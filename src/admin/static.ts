import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { join } from "@std/path";

function looksLikeStaticAsset(path: string): boolean {
  if (path.includes("/assets/")) return true;
  return /\.[a-zA-Z0-9]+$/.test(path);
}

/** Serve the Vite-built admin SPA from frontend/dist under /ui. */
export function mountAdminUi(app: Hono, uiDistDir: string): void {
  const indexPath = join(uiDistDir, "index.html");

  app.get("/ui", (c) => c.redirect("/ui/"));

  app.use(
    "/ui/*",
    serveStatic({
      root: uiDistDir,
      // node:path join ignores root if the second segment is absolute — keep relative.
      rewriteRequestPath: (path) => {
        const stripped = path.replace(/^\/ui\/?/, "");
        if (!stripped || stripped === "/") return "index.html";
        return stripped;
      },
    }),
  );

  // SPA fallback for client-side routes only — never for hashed assets.
  // Returning HTML for a missing .js module causes a blank white screen.
  app.get("/ui/*", async (c) => {
    if (looksLikeStaticAsset(c.req.path)) {
      return c.text("Not found", 404);
    }
    try {
      const html = await Deno.readTextFile(indexPath);
      return c.html(html);
    } catch {
      return c.text(
        "Admin UI is not built. Run `deno task ui:build` (or use `deno task ui:dev` during development).",
        503,
      );
    }
  });
}
