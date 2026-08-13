import { Database } from "bun:sqlite";
import { dbPath } from "../util/paths.ts";

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped_overlap"
  | "interrupted_unknown"
  | "cancelled";

export type RunRow = {
  id: string;
  automation_id: string;
  occurrence_key: string;
  trigger_kind: string;
  status: RunStatus;
  started_at: number | null;
  finished_at: number | null;
  summary: string | null;
  error: string | null;
  manual: number;
  created_at: number;
};

export type AutomationStateRow = {
  automation_id: string;
  enabled_override: number | null;
  last_run_id: string | null;
  last_status: string | null;
  last_finished_at: number | null;
  next_run_at: number | null;
  last_claimed_occurrence_ms: number | null;
  schedule_initialized_at: number | null;
};

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS global_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    paused INTEGER NOT NULL DEFAULT 0,
    config_error TEXT,
    updated_at INTEGER NOT NULL
  );

  INSERT OR IGNORE INTO global_state (id, paused, config_error, updated_at)
  VALUES (1, 0, NULL, 0);

  CREATE TABLE IF NOT EXISTS automation_state (
    automation_id TEXT PRIMARY KEY,
    enabled_override INTEGER,
    last_run_id TEXT,
    last_status TEXT,
    last_finished_at INTEGER,
    next_run_at INTEGER,
    last_claimed_occurrence_ms INTEGER
  );

  CREATE TABLE IF NOT EXISTS occurrence_claims (
    occurrence_key TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    run_id TEXT,
    claimed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    trigger_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    summary TEXT,
    error TEXT,
    manual INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_runs_automation_created
    ON runs (automation_id, created_at DESC);
  `,
  `
  ALTER TABLE automation_state ADD COLUMN schedule_initialized_at INTEGER;
  `,
];

export class Store {
  readonly db: Database;

  constructor(path = dbPath()) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const current =
      this.db
        .query<{ version: number }, []>(
          "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
        )
        .get()?.version ?? 0;
    for (let i = current; i < MIGRATIONS.length; i += 1) {
      const sql = MIGRATIONS[i];
      if (!sql) continue;
      this.db.transaction(() => {
        this.db.exec(sql);
        this.db
          .query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(i + 1, Date.now());
      })();
    }
  }

  getPaused(): boolean {
    const row = this.db
      .query<{ paused: number }, []>("SELECT paused FROM global_state WHERE id = 1")
      .get();
    return (row?.paused ?? 0) === 1;
  }

  setPaused(paused: boolean): void {
    this.db
      .query("UPDATE global_state SET paused = ?, updated_at = ? WHERE id = 1")
      .run(paused ? 1 : 0, Date.now());
  }

  getConfigError(): string | null {
    const row = this.db
      .query<{ config_error: string | null }, []>(
        "SELECT config_error FROM global_state WHERE id = 1",
      )
      .get();
    return row?.config_error ?? null;
  }

  setConfigError(error: string | null): void {
    this.db
      .query("UPDATE global_state SET config_error = ?, updated_at = ? WHERE id = 1")
      .run(error, Date.now());
  }

  getAutomationState(id: string): AutomationStateRow | null {
    return (
      this.db
        .query<AutomationStateRow, [string]>(
          "SELECT * FROM automation_state WHERE automation_id = ?",
        )
        .get(id) ?? null
    );
  }

  ensureAutomationState(id: string): void {
    this.db
      .query(
        `INSERT OR IGNORE INTO automation_state
          (automation_id, enabled_override, last_run_id, last_status, last_finished_at, next_run_at, last_claimed_occurrence_ms, schedule_initialized_at)
         VALUES (?, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
      )
      .run(id);
  }

  /** Returns true when this call newly armed the schedule (first-seen). */
  markScheduleInitialized(id: string, atMs = Date.now()): boolean {
    this.ensureAutomationState(id);
    const state = this.getAutomationState(id);
    if (state?.schedule_initialized_at != null) return false;
    this.db
      .query(
        "UPDATE automation_state SET schedule_initialized_at = ? WHERE automation_id = ? AND schedule_initialized_at IS NULL",
      )
      .run(atMs, id);
    return true;
  }

  wasSchedulePreviouslyInitialized(id: string): boolean {
    const state = this.getAutomationState(id);
    return state?.schedule_initialized_at != null;
  }

  setEnabledOverride(id: string, enabled: boolean | null): void {
    this.ensureAutomationState(id);
    this.db
      .query("UPDATE automation_state SET enabled_override = ? WHERE automation_id = ?")
      .run(enabled === null ? null : enabled ? 1 : 0, id);
  }

  setNextRunAt(id: string, nextRunAt: number | null): void {
    this.ensureAutomationState(id);
    this.db
      .query("UPDATE automation_state SET next_run_at = ? WHERE automation_id = ?")
      .run(nextRunAt, id);
  }

  setLastClaimedOccurrenceMs(id: string, occurrenceMs: number | null): void {
    this.ensureAutomationState(id);
    this.db
      .query("UPDATE automation_state SET last_claimed_occurrence_ms = ? WHERE automation_id = ?")
      .run(occurrenceMs, id);
  }

  tryClaimOccurrence(input: {
    occurrenceKey: string;
    automationId: string;
    runId: string;
    claimedAt: number;
  }): boolean {
    try {
      this.db
        .query(
          `INSERT INTO occurrence_claims (occurrence_key, automation_id, run_id, claimed_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(input.occurrenceKey, input.automationId, input.runId, input.claimedAt);
      return true;
    } catch {
      return false;
    }
  }

  insertRun(run: RunRow): void {
    this.db
      .query(
        `INSERT INTO runs
          (id, automation_id, occurrence_key, trigger_kind, status, started_at, finished_at, summary, error, manual, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.automation_id,
        run.occurrence_key,
        run.trigger_kind,
        run.status,
        run.started_at,
        run.finished_at,
        run.summary,
        run.error,
        run.manual,
        run.created_at,
      );
  }

  updateRun(
    id: string,
    patch: Partial<Pick<RunRow, "status" | "started_at" | "finished_at" | "summary" | "error">>,
  ): void {
    const current = this.getRun(id);
    if (!current) return;
    this.db
      .query(
        `UPDATE runs SET status = ?, started_at = ?, finished_at = ?, summary = ?, error = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.started_at ?? current.started_at,
        patch.finished_at ?? current.finished_at,
        patch.summary ?? current.summary,
        patch.error ?? current.error,
        id,
      );
    if (patch.status && patch.status !== "queued" && patch.status !== "running") {
      this.ensureAutomationState(current.automation_id);
      this.db
        .query(
          `UPDATE automation_state
           SET last_run_id = ?, last_status = ?, last_finished_at = ?
           WHERE automation_id = ?`,
        )
        .run(id, patch.status, patch.finished_at ?? Date.now(), current.automation_id);
    }
  }

  getRun(id: string): RunRow | null {
    return this.db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id) ?? null;
  }

  listRuns(automationId: string, limit = 20): RunRow[] {
    return this.db
      .query<RunRow, [string, number]>(
        `SELECT * FROM runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(automationId, limit);
  }

  listActiveRuns(): RunRow[] {
    return this.db
      .query<RunRow, []>(
        `SELECT * FROM runs WHERE status IN ('queued', 'running') ORDER BY created_at ASC`,
      )
      .all();
  }

  countActiveRuns(): number {
    return (
      this.db
        .query<{ c: number }, []>(
          `SELECT COUNT(*) AS c FROM runs WHERE status IN ('queued', 'running')`,
        )
        .get()?.c ?? 0
    );
  }

  countActiveForAutomation(automationId: string): number {
    return (
      this.db
        .query<{ c: number }, [string]>(
          `SELECT COUNT(*) AS c FROM runs
           WHERE automation_id = ? AND status IN ('queued', 'running')`,
        )
        .get(automationId)?.c ?? 0
    );
  }

  markAbandonedRunsInterrupted(): number {
    const active = this.listActiveRuns();
    for (const run of active) {
      this.updateRun(run.id, {
        status: "interrupted_unknown",
        finished_at: Date.now(),
        error: "worker restarted; abandoned run requires manual retry",
        summary: "status=interrupted_unknown",
      });
    }
    return active.length;
  }

  latestRun(automationId: string): RunRow | null {
    return (
      this.db
        .query<RunRow, [string]>(
          `SELECT * FROM runs WHERE automation_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(automationId) ?? null
    );
  }

  latestQueuedRun(automationId: string): RunRow | null {
    return (
      this.db
        .query<RunRow, [string]>(
          `SELECT * FROM runs
           WHERE automation_id = ? AND status = 'queued'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(automationId) ?? null
    );
  }

  hasRunningRun(automationId: string): boolean {
    return (
      (this.db
        .query<{ c: number }, [string]>(
          `SELECT COUNT(*) AS c FROM runs
           WHERE automation_id = ? AND status = 'running'`,
        )
        .get(automationId)?.c ?? 0) > 0
    );
  }
}
