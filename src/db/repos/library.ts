import type { SqlDatabase } from "../types.ts";

export type LibraryLauncher = "npx" | "uvx" | "custom";

export type LibraryPreset = {
  id: string;
  name: string;
  launcher: LibraryLauncher;
  package?: string;
  command?: string;
  extraArgs?: string;
  argsLines?: string;
  env: Array<{
    key: string;
    value: string;
    required?: boolean;
    description?: string;
    secret?: boolean;
  }>;
  git: string;
  ref: string;
  startNow: boolean;
};

export type LibraryItem = {
  id: string;
  name: string;
  blurb: string;
  tags: string[];
  source: string;
  category: string;
  featured: boolean;
  sortOrder: number;
  preset: LibraryPreset;
  createdAt: string;
  updatedAt: string;
};

export type LibraryItemInput = {
  id: string;
  name: string;
  blurb: string;
  tags?: string[];
  source?: string;
  category: string;
  featured?: boolean;
  sortOrder?: number;
  preset: LibraryPreset;
};

export type LibraryItemUpdate = {
  name?: string;
  blurb?: string;
  tags?: string[];
  source?: string;
  category?: string;
  featured?: boolean;
  sortOrder?: number;
  preset?: LibraryPreset;
};

export type LibraryCategory = {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type LibraryCategoryInput = {
  id: string;
  label: string;
  description?: string;
  sortOrder?: number;
};

export type LibraryCategoryUpdate = {
  label?: string;
  description?: string;
  sortOrder?: number;
};

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "object" && value !== null) return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeLibraryPreset(
  raw: unknown,
  fallbackId: string,
): LibraryPreset {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<LibraryPreset>;
  const launcher = p.launcher === "uvx" || p.launcher === "custom"
    ? p.launcher
    : "npx";
  const env = Array.isArray(p.env)
    ? p.env.map((e) => {
      const row = e as {
        key?: unknown;
        value?: unknown;
        required?: unknown;
        description?: unknown;
        secret?: unknown;
      };
      const out: LibraryPreset["env"][number] = {
        key: String(row.key ?? ""),
        value: String(row.value ?? ""),
      };
      if (typeof row.required === "boolean") out.required = row.required;
      if (row.description != null && String(row.description).trim()) {
        out.description = String(row.description).trim();
      }
      if (typeof row.secret === "boolean") out.secret = row.secret;
      return out;
    })
    : [{ key: "", value: "" }];
  return {
    id: String(p.id ?? fallbackId),
    name: String(p.name ?? fallbackId),
    launcher,
    package: p.package != null ? String(p.package) : undefined,
    command: p.command != null ? String(p.command) : undefined,
    extraArgs: p.extraArgs != null ? String(p.extraArgs) : undefined,
    argsLines: p.argsLines != null ? String(p.argsLines) : undefined,
    env,
    git: String(p.git ?? ""),
    ref: String(p.ref ?? ""),
    startNow: p.startNow !== false,
  };
}

function rowToItem(row: Record<string, unknown>): LibraryItem {
  const id = String(row.id);
  return {
    id,
    name: String(row.name),
    blurb: String(row.blurb),
    tags: parseJson<string[]>(row.tags, []),
    source: String(row.source ?? ""),
    category: String(row.category),
    featured: Boolean(row.featured),
    sortOrder: Number(row.sort_order ?? 0),
    preset: normalizeLibraryPreset(parseJson(row.preset, {}), id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToCategory(row: Record<string, unknown>): LibraryCategory {
  return {
    id: String(row.id),
    label: String(row.label),
    description: String(row.description ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class LibraryRepository {
  constructor(private readonly db: SqlDatabase) {}

  async count(): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS c FROM library_items").get();
    return Number(row?.c ?? 0);
  }

  async categoryCount(): Promise<number> {
    const row = await this.db.prepare(
      "SELECT COUNT(*) AS c FROM library_categories",
    ).get();
    return Number(row?.c ?? 0);
  }

  async listCategories(): Promise<LibraryCategory[]> {
    return (await this.db.prepare(`
      SELECT * FROM library_categories
      ORDER BY sort_order ASC, id ASC
    `).all()).map(rowToCategory);
  }

  async getCategory(id: string): Promise<LibraryCategory | null> {
    const row = await this.db.prepare(
      "SELECT * FROM library_categories WHERE id = ?",
    ).get(id);
    return row ? rowToCategory(row) : null;
  }

  async createCategory(input: LibraryCategoryInput): Promise<LibraryCategory> {
    if (!/^[A-Za-z0-9_-]+$/.test(input.id)) {
    throw new Error("id must match /^[A-Za-z0-9_-]+$/");
    }
    if (await this.getCategory(input.id)) {
    throw new Error(`library category already exists: ${input.id}`);
    }
    const ts = now();
    await this.db.prepare(`
      INSERT INTO library_categories (
        id, label, description, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.label,
      input.description ?? "",
      input.sortOrder ?? 0,
      ts,
      ts,
    );
    return (await this.getCategory(input.id))!;
  }

  async updateCategory(id: string, patch: LibraryCategoryUpdate): Promise<LibraryCategory> {
    const existing = await this.getCategory(id);
    if (!existing) throw new Error(`library category not found: ${id}`);
    const next = {
      label: patch.label ?? existing.label,
      description: patch.description ?? existing.description,
      sortOrder: patch.sortOrder ?? existing.sortOrder,
      updatedAt: now(),
    };
    await this.db.prepare(`
      UPDATE library_categories SET
        label = ?, description = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.label,
      next.description,
      next.sortOrder,
      next.updatedAt,
      id,
    );
    return (await this.getCategory(id))!;
  }

  async deleteCategory(id: string): Promise<boolean> {
    if (!await this.getCategory(id)) return false;
    await this.db.prepare("DELETE FROM library_categories WHERE id = ?").run(id);
    return true;
  }

  async list(): Promise<LibraryItem[]> {
    return (await this.db.prepare(`
      SELECT * FROM library_items
      ORDER BY sort_order ASC, id ASC
    `).all()).map(rowToItem);
  }

  async get(id: string): Promise<LibraryItem | null> {
    const row = await this.db.prepare("SELECT * FROM library_items WHERE id = ?").get(
      id,
    );
    return row ? rowToItem(row) : null;
  }

  async create(input: LibraryItemInput): Promise<LibraryItem> {
    if (!/^[A-Za-z0-9_-]+$/.test(input.id)) {
    throw new Error("id must match /^[A-Za-z0-9_-]+$/");
    }
    if (await this.get(input.id)) {
    throw new Error(`library item already exists: ${input.id}`);
    }
    const ts = now();
    const featured = input.featured ? 1 : 0;
    const sortOrder = input.sortOrder ?? 0;
    const tags = JSON.stringify(input.tags ?? []);
    const preset = JSON.stringify(normalizeLibraryPreset(input.preset, input.id));
    await this.db.prepare(`
      INSERT INTO library_items (
        id, name, blurb, tags, source, category, featured, sort_order,
        preset, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.name,
      input.blurb,
      tags,
      input.source ?? "",
      input.category,
      featured,
      sortOrder,
      preset,
      ts,
      ts,
    );
    return (await this.get(input.id))!;
  }

  async update(id: string, patch: LibraryItemUpdate): Promise<LibraryItem> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`library item not found: ${id}`);
    const next: LibraryItem = {
      ...existing,
      name: patch.name ?? existing.name,
      blurb: patch.blurb ?? existing.blurb,
      tags: patch.tags ?? existing.tags,
      source: patch.source ?? existing.source,
      category: patch.category ?? existing.category,
      featured: patch.featured ?? existing.featured,
      sortOrder: patch.sortOrder ?? existing.sortOrder,
      preset: patch.preset
        ? normalizeLibraryPreset(patch.preset, id)
        : existing.preset,
      updatedAt: now(),
    };
    await this.db.prepare(`
      UPDATE library_items SET
        name = ?, blurb = ?, tags = ?, source = ?, category = ?,
        featured = ?, sort_order = ?, preset = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.name,
      next.blurb,
      JSON.stringify(next.tags),
      next.source,
      next.category,
      next.featured ? 1 : 0,
      next.sortOrder,
      JSON.stringify(next.preset),
      next.updatedAt,
      id,
    );
    return (await this.get(id))!;
  }

  async delete(id: string): Promise<boolean> {
    if (!await this.get(id)) return false;
    await this.db.prepare("DELETE FROM library_items WHERE id = ?").run(id);
    return true;
  }
}
