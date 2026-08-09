-- Persist restart / crash observability on server_runtime.

ALTER TABLE server_runtime ADD COLUMN restart_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE server_runtime ADD COLUMN last_started_at TEXT;
ALTER TABLE server_runtime ADD COLUMN last_crash_at TEXT;
