import type { SqlDatabase } from "../types.ts";

export class SettingsRepository {
  constructor(private readonly db: SqlDatabase) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? String(row.value) : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
  }

  async getAll(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const row of await this.db.prepare("SELECT key, value FROM settings").all()) {
      out[String(row.key)] = String(row.value);
    }
    return out;
  }
}
