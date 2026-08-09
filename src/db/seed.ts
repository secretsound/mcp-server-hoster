import type { CreateServerInput } from "./types.ts";
import type { ServerRepository } from "./repos/servers.ts";
import type {
  LibraryCategoryInput,
  LibraryItemInput,
  LibraryRepository,
} from "./repos/library.ts";

type SeedFile = {
  servers?: CreateServerInput[];
  /** @deprecated Prefer seed/library.json via LIBRARY_SEED_PATH */
  library?: LibraryItemInput[];
  libraryCategories?: LibraryCategoryInput[];
};

type LibrarySeedFile = {
  categories?: LibraryCategoryInput[];
  items?: LibraryItemInput[];
};

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    await Deno.stat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

export async function seedIfEmpty(
  servers: ServerRepository,
  seedPath: string | null,
  library?: LibraryRepository,
  librarySeedPath?: string | null,
): Promise<void> {
  const seedData = seedPath ? await readJsonFile<SeedFile>(seedPath) : null;
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

  const librarySeed = librarySeedPath
    ? await readJsonFile<LibrarySeedFile>(librarySeedPath)
    : null;
  if (librarySeedPath && !librarySeed) {
    console.error(`[db] library seed file not found: ${librarySeedPath}`);
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
