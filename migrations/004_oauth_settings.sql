-- OAuth / SSO configuration stored in the database (editable via admin UI).

CREATE TABLE IF NOT EXISTS oauth_config (
  id TEXT PRIMARY KEY,
  public_url TEXT,
  auto_provision INTEGER NOT NULL DEFAULT 0,
  default_role TEXT NOT NULL DEFAULT 'user',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_providers (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  client_secret TEXT NOT NULL DEFAULT '',
  issuer TEXT,
  authorization_endpoint TEXT,
  token_endpoint TEXT,
  userinfo_endpoint TEXT,
  scopes TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
