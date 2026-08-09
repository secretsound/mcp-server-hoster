import type { SqlDatabase } from "../types.ts";

export type AuditEvent = {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditAppendInput = {
  tenantId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type AuditListOpts = {
  tenantId: string;
  limit?: number;
  offset?: number;
  action?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
};

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `aud_${crypto.randomUUID().replace(/-/g, "")}`;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function rowToEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    actorUserId: (row.actor_user_id as string | null) ?? null,
    actorEmail: (row.actor_email as string | null) ?? null,
    action: String(row.action),
    resourceType: (row.resource_type as string | null) ?? null,
    resourceId: (row.resource_id as string | null) ?? null,
    summary: String(row.summary),
    metadata: parseJson(row.metadata),
    createdAt: String(row.created_at),
  };
}

export class AuditRepository {
  constructor(private readonly db: SqlDatabase) {}

  async append(input: AuditAppendInput): Promise<AuditEvent> {
    const id = newId();
    const createdAt = now();
    const metadata = JSON.stringify(input.metadata ?? {});
    await this.db.prepare(`
      INSERT INTO audit_events (
        id, tenant_id, actor_user_id, actor_email, action,
        resource_type, resource_id, summary, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.tenantId,
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.summary,
      metadata,
      createdAt,
    );
    return {
      id,
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? {},
      createdAt,
    };
  }

  async list(opts: AuditListOpts): Promise<{ events: AuditEvent[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const where = ["tenant_id = ?"];
    const params: unknown[] = [opts.tenantId];
    if (opts.action) {
      where.push("action = ?");
      params.push(opts.action);
    }
    if (opts.resourceType) {
      where.push("resource_type = ?");
      params.push(opts.resourceType);
    }
    if (opts.resourceId) {
      where.push("resource_id = ?");
      params.push(opts.resourceId);
    }
    const clause = where.join(" AND ");
    const total = Number(
      (await this.db.prepare(
        `SELECT COUNT(*) AS c FROM audit_events WHERE ${clause}`,
      ).get(...params))?.c ?? 0,
    );
    const rows = await this.db.prepare(`
      SELECT * FROM audit_events
      WHERE ${clause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return { events: rows.map(rowToEvent), total };
  }
}
