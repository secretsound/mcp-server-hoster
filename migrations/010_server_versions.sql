-- Track package pins and last upgrade time for MCP servers.

ALTER TABLE servers ADD COLUMN package_name TEXT;
ALTER TABLE servers ADD COLUMN package_version TEXT;
ALTER TABLE servers ADD COLUMN last_upgraded_at TEXT;
