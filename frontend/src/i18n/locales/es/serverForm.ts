export default {
  id: "ID",
  displayName: "Nombre visible",
  launchWith: "Lanzar con",
  launcherNpx: "npx (paquete Node)",
  launcherUvx: "uvx (Python / git+)",
  launcherCustom: "Comando personalizado",
  npmPackage: "paquete npm",
  pypiPackage: "Nombre del paquete PyPI",
  command: "Comando",
  version: "Versión",
  versionHint: "(fijación opcional — dejar vacío para la última)",
  versionPlaceholderUvx: "p. ej. 0.3.1",
  versionPlaceholderNpx: "p. ej. 0.6.2",
  extraArgs: "Args extra",
  extraHintNpx: "(ruta o flags opcionales después del paquete)",
  extraHintUvx:
    "(opciones uvx como --python / --with antes del paquete, o flags de la herramienta después)",
  extraPlaceholderNpx: "p. ej. /data/workspaces/fs",
  extraPlaceholderUvx: "p. ej. --python 3.12 --with 'mcp[cli]<2'",
  args: "Args",
  argsHint: "(uno por línea)",
  environment: "Entorno",
  advancedGit:
    "Avanzado: clonar un repo git en el sandbox (opcional)",
  gitUrl: "URL de Git",
  gitRef: "Ref de Git",
  gitUvxHint:
    "Para uvx --from git+https://..., déjalo vacío — uvx descarga el paquete.",
  startImmediately: "Iniciar inmediatamente tras guardar",
  packageRequiredNpx: "El paquete es obligatorio para npx",
  packageRequiredUvx:
    "Indica el nombre del paquete PyPI en “Nombre del paquete PyPI” (p. ej. mcp-portainer). No necesitas la URL Git avanzada para Portainer. Para uvx --from … usa la plantilla de comando personalizado.",
  looksLikeNpm:
    "Eso parece un paquete npm. Para Portainer usa el nombre PyPI mcp-portainer (o cambia “Lanzar con” de nuevo a npx para servidores Node).",
  commandRequired: "El comando es obligatorio",
  setKeyBeforeStart: "Configura {key} antes de iniciar.",
  replacePlaceholder:
    "Sustituye el valor de marcador de {key} antes de iniciar.",
} as const;
