import {
  applyPackageVersion,
  buildUvxArgs,
  extractPackageSpec,
  formatNpmSpec,
  formatUvxSpec,
  parseNpmSpec,
  parseUvxSpec,
  splitUvxInvocation,
} from "../src/package_spec.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseNpmSpec("@scope/pkg@1.2.3").name === "@scope/pkg", "npm scoped name");
assert(parseNpmSpec("@scope/pkg@1.2.3").version === "1.2.3", "npm scoped ver");
assert(parseNpmSpec("pkg@2").version === "2", "npm bare ver");
assert(parseUvxSpec("mcp-foo==0.1.0").version === "0.1.0", "uvx ==");
assert(formatNpmSpec("@a/b", "3") === "@a/b@3", "format npm");
assert(formatUvxSpec("mcp-foo", "1") === "mcp-foo==1", "format uvx");

const npx = extractPackageSpec({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-everything@0.6.2"],
});
assert(npx.kind === "npx", "npx kind");
assert(npx.version === "0.6.2", "npx version");

const latest = applyPackageVersion(
  {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything@0.6.2", "extra"],
  },
  null,
);
assert(latest.args[1] === "@modelcontextprotocol/server-everything", "unpin");
assert(latest.args[2] === "extra", "preserve extra");
assert(latest.version === null, "latest version null");

const pinned = applyPackageVersion(
  { command: "uvx", args: ["mcp-portainer"] },
  "0.3.1",
);
assert(pinned.args[0] === "mcp-portainer==0.3.1", "uvx pin");

const withOpts = splitUvxInvocation([
  "--python",
  "3.12",
  "--with",
  "mcp[cli]>=1.12.0,<2",
  "mealie-mcp-server",
  "--verbose",
]);
assert(withOpts.packageSpec === "mealie-mcp-server", "uvx package after opts");
assert(
  withOpts.options.join(" ") ===
    "--python 3.12 --with mcp[cli]>=1.12.0,<2",
  "uvx options",
);
assert(withOpts.toolArgs.join(" ") === "--verbose", "uvx tool args");

const built = buildUvxArgs("mealie-mcp-server", [
  "--python",
  "3.12",
  "--with",
  "mcp[cli]>=1.12.0,<2",
]);
assert(
  built.join(" ") ===
    "--python 3.12 --with mcp[cli]>=1.12.0,<2 mealie-mcp-server",
  "build uvx args",
);

const pinnedWith = applyPackageVersion(
  {
    command: "uvx",
    args: [
      "--python",
      "3.12",
      "--with",
      "mcp[cli]>=1.12.0,<2",
      "mealie-mcp-server",
    ],
  },
  "0.1.0",
);
assert(
  pinnedWith.args.join(" ") ===
    "--python 3.12 --with mcp[cli]>=1.12.0,<2 mealie-mcp-server==0.1.0",
  "uvx pin keeps options",
);
assert(extractPackageSpec({
  command: "uvx",
  args: pinnedWith.args,
}).name === "mealie-mcp-server", "extract uvx name with options");

const git = applyPackageVersion(
  {
    command: "deno",
    args: ["run", "-A", "main.ts"],
    source: { git: "https://example.com/r.git", ref: "main" },
  },
  "v2",
);
assert(git.source?.ref === "v2", "git ref");

console.log("test_package_spec: ok");
