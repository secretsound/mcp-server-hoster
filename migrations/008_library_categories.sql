-- Library category labels (catalog browsing), editable like library_items.

CREATE TABLE IF NOT EXISTS library_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_categories_sort
  ON library_categories(sort_order, id);
