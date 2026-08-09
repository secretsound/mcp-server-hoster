-- Curated MCP server library catalog (install presets for the admin UI).

CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  blurb TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  preset TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_category
  ON library_items(category);

CREATE INDEX IF NOT EXISTS idx_library_sort
  ON library_items(sort_order, id);
