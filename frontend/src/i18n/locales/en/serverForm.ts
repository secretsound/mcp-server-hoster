export default {
  id: "ID",
  displayName: "Display name",
  launchWith: "Launch with",
  launcherNpx: "npx (Node package)",
  launcherUvx: "uvx (Python / git+)",
  launcherCustom: "Custom command",
  npmPackage: "npm package",
  pypiPackage: "PyPI package name",
  command: "Command",
  version: "Version",
  versionHint: "(optional pin — leave empty for latest)",
  versionPlaceholderUvx: "e.g. 0.3.1",
  versionPlaceholderNpx: "e.g. 0.6.2",
  extraArgs: "Extra args",
  extraHintNpx: "(optional path or flags after the package)",
  extraHintUvx:
    "(optional flags after the package — not --from; use Custom for that)",
  extraPlaceholderNpx: "e.g. /data/workspaces/fs",
  extraPlaceholderUvx: "optional tool flags",
  args: "Args",
  argsHint: "(one per line)",
  environment: "Environment",
  advancedGit:
    "Advanced: clone a git repo into the sandbox (optional)",
  gitUrl: "Git URL",
  gitRef: "Git ref",
  gitUvxHint:
    "For uvx --from git+https://..., leave empty — uvx fetches the package.",
  startImmediately: "Start immediately after save",
  packageRequiredNpx: "Package is required for npx",
  packageRequiredUvx:
    "Put the PyPI package name in “PyPI package name” (e.g. mcp-portainer). You do not need the Advanced Git URL for Portainer. For uvx --from … use the Custom command template instead.",
  looksLikeNpm:
    "That looks like an npm package. For Portainer use PyPI name mcp-portainer (or switch Launch with back to npx for Node servers).",
  commandRequired: "Command is required",
  setKeyBeforeStart: "Set {key} before starting.",
  replacePlaceholder: "Replace the placeholder value for {key} before starting.",
} as const;
