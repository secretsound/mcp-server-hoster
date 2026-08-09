-- Durable admin audit trail (auth, keys, invites, server lifecycle).

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  summary TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created
  ON audit_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON audit_events(action);

CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON audit_events(resource_type, resource_id);
