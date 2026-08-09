-- Operator denylist: tool names (original backend names) hidden from MCP clients.

ALTER TABLE servers ADD COLUMN disabled_tools TEXT NOT NULL DEFAULT '[]';
