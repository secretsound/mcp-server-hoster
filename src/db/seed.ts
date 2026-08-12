import type { CreateServerInput } from "./types.ts";
import type { ServerRepository } from "./repos/servers.ts";
import type {
  LibraryCategoryInput,
  LibraryItemInput,
  LibraryRepository,
} from "./repos/library.ts";

type SeedFile = {
  servers?: CreateServerInput[];
  /** @deprecated Prefer catalog/catalog.json via LIBRARY_SEED_PATH */
  library?: LibraryItemInput[];
  libraryCategories?: LibraryCategoryInput[];
};

type LibrarySeedFile = {
  categories?: LibraryCategoryInput[];
  items?: LibraryItemInput[];
};

/** Bundled fallback when offline / private network. */
export const DEFAULT_LIBRARY_CATALOG_FILE = "./catalog/catalog.json";

function isRemoteUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    await Deno.stat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

async function readJsonUrl<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      console.error(
        `[db] library catalog fetch failed (${res.status}): ${url}`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(
      `[db] library catalog fetch error: ${url} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/** Load JSON from a local path or http(s) URL. */
export async function loadJsonSource<T>(
  source: string,
): Promise<T | null> {
  if (isRemoteUrl(source)) return await readJsonUrl<T>(source);
  return await readJsonFile<T>(source);
}

/**
 * Resolve library catalog JSON.
 * Prefer LIBRARY_SEED_PATH (URL or file); if remote fails, fall back to bundled file.
 */
export async function loadLibrarySeed(
  librarySeedPath: string | null,
): Promise<LibrarySeedFile | null> {
  if (!librarySeedPath) return null;

  const primary = await loadJsonSource<LibrarySeedFile>(librarySeedPath);
  if (primary) return primary;

  if (
    isRemoteUrl(librarySeedPath) &&
    librarySeedPath !== DEFAULT_LIBRARY_CATALOG_FILE
  ) {
    console.error(
      `[db] falling back to bundled catalog: ${DEFAULT_LIBRARY_CATALOG_FILE}`,
    );
    return await readJsonFile<LibrarySeedFile>(DEFAULT_LIBRARY_CATALOG_FILE);
  }
  return null;
}

export async function seedIfEmpty(
  servers: ServerRepository,
  seedPath: string | null,
  library?: LibraryRepository,
  librarySeedPath?: string | null,
): Promise<void> {
  const seedData = seedPath ? await loadJsonSource<SeedFile>(seedPath) : null;
  if (seedPath && !seedData) {
    console.error(`[db] seed file not found: ${seedPath}`);
  }

  if ((await servers.count()) === 0 && seedData?.servers?.length) {
    for (const server of seedData.servers) {
      await servers.create(server);
      console.error(`[db] seeded server ${server.id}`);
    }
  }

  if (!library) return;

  const librarySeed = await loadLibrarySeed(librarySeedPath ?? null);
  if (librarySeedPath && !librarySeed) {
    console.error(`[db] library seed not available: ${librarySeedPath}`);
  }

  const categories = librarySeed?.categories ??
    seedData?.libraryCategories ??
    [];
  const items = librarySeed?.items ?? seedData?.library ?? [];

  if (categories.length) {
    const existingCats = new Set((await library.listCategories()).map((c) => c.id));
    for (const category of categories) {
      if (existingCats.has(category.id)) continue;
      await library.createCategory(category);
      console.error(`[db] seeded library category ${category.id}`);
    }
  }

  if (items.length) {
    const existing = new Map((await library.list()).map((i) => [i.id, i]));
    for (const item of items) {
      const prev = existing.get(item.id);
      if (!prev) {
        await library.create(item);
        console.error(`[db] seeded library item ${item.id}`);
        continue;
      }
      // Refresh catalog metadata / featured flags without wiping custom presets.
      const prevTags = JSON.stringify(prev.tags ?? []);
      const nextTags = JSON.stringify(item.tags ?? []);
      if (
        prev.featured !== !!item.featured ||
        prev.sortOrder !== (item.sortOrder ?? 0) ||
        prev.blurb !== item.blurb ||
        prev.name !== item.name ||
        prev.category !== item.category ||
        prev.source !== item.source ||
        prevTags !== nextTags
      ) {
        await library.update(item.id, {
          name: item.name,
          blurb: item.blurb,
          tags: item.tags,
          source: item.source,
          category: item.category,
          featured: item.featured,
          sortOrder: item.sortOrder,
        });
        console.error(`[db] refreshed library item ${item.id}`);
      }
    }
  }
}
