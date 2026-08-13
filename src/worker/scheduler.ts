import type { ActionConfig, ResolvedAutomation } from "../config/schema.ts";
import { GLOBAL_CONCURRENCY } from "../constants.ts";
import { executeAction, type RunExecutionResult } from "../herdr/runners.ts";
import type { Store } from "../store/db.ts";
import { cronOccurrenceKey, latestDueCronOccurrenceMs, nextCronRunMs } from "../triggers/cron.ts";
import {
  eventDedupeToken,
  eventMatches,
  eventOccurrenceKey,
  normalizeHerdrEvent,
} from "../triggers/events.ts";
import {
  intervalOccurrenceKey,
  latestMissedIntervalOccurrenceMs,
  nextIntervalRunMs,
} from "../triggers/interval.ts";
import { sanitizeError } from "../util/redaction.ts";

export type ActionExecutor = (input: {
  automationId: string;
  cwd: string;
  action: ActionConfig;
  timeoutSeconds: number;
  workspaceId?: string;
}) => Promise<RunExecutionResult>;

export type SchedulerSnapshotItem = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  nextRunAt: number | null;
  lastStatus: string | null;
  lastFinishedAt: number | null;
  running: boolean;
};

type QueuedJob = {
  runId: string;
  automationId: string;
  execute: () => Promise<void>;
};

export class Scheduler {
  private automations: ResolvedAutomation[] = [];
  private readonly running = new Set<string>();
  private readonly queue: QueuedJob[] = [];
  private activeCount = 0;
  private catchUpDone = false;
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly executor: ActionExecutor = executeAction,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private now(): number {
    return this.clock();
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  async drain(timeoutMs = 2_000): Promise<void> {
    const start = Date.now();
    while (this.activeCount > 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  setAutomations(automations: ResolvedAutomation[]): void {
    this.automations = automations;
    for (const automation of automations) {
      this.store.ensureAutomationState(automation.id);
      this.armFirstSeenSchedule(automation);
      this.refreshNextRun(automation);
    }
    if (!this.catchUpDone) {
      this.catchUpMissed();
      this.catchUpDone = true;
    }
  }

  getAutomations(): ResolvedAutomation[] {
    return this.automations;
  }

  isEnabled(automation: ResolvedAutomation): boolean {
    const state = this.store.getAutomationState(automation.id);
    if (state?.enabled_override !== null && state?.enabled_override !== undefined) {
      return state.enabled_override === 1;
    }
    return automation.enabled;
  }

  setEnabled(id: string, enabled: boolean): void {
    this.store.setEnabledOverride(id, enabled);
    const automation = this.automations.find((item) => item.id === id);
    if (automation) {
      this.armFirstSeenSchedule(automation);
      this.refreshNextRun(automation);
    }
  }

  /**
   * First-seen cron/interval: durable-arm the schedule and acknowledge the latest
   * past occurrence without executing it. Catch-up never runs for first-seen state.
   */
  private armFirstSeenSchedule(automation: ResolvedAutomation): void {
    if (automation.trigger.type !== "cron" && automation.trigger.type !== "interval") return;
    const previously = this.store.wasSchedulePreviouslyInitialized(automation.id);
    if (previously) return;
    const now = this.now();
    this.store.markScheduleInitialized(automation.id, now);
    if (automation.trigger.type === "cron") {
      const due = latestDueCronOccurrenceMs(
        automation.trigger.expr,
        automation.resolvedTimezone,
        now,
      );
      // Acknowledge all history at/before now so first install never executes catch-up.
      this.store.setLastClaimedOccurrenceMs(automation.id, due ?? now);
      return;
    }
    // Interval baseline: persist arming time so nextIntervalRunMs does not treat
    // null last_claimed as "schedule from wall clock now" on every refresh/tick
    // (which would slide the deadline forever and never fire).
    this.store.setLastClaimedOccurrenceMs(automation.id, now);
  }

  private refreshNextRun(automation: ResolvedAutomation): void {
    if (!this.isEnabled(automation) || this.store.getPaused()) {
      this.store.setNextRunAt(automation.id, null);
      return;
    }
    if (automation.trigger.type === "cron") {
      this.store.setNextRunAt(
        automation.id,
        nextCronRunMs(automation.trigger.expr, automation.resolvedTimezone),
      );
      return;
    }
    if (automation.trigger.type === "interval") {
      const state = this.store.getAutomationState(automation.id);
      this.store.setNextRunAt(
        automation.id,
        nextIntervalRunMs(
          automation.trigger.every,
          state?.last_claimed_occurrence_ms ?? null,
          this.now(),
        ),
      );
      return;
    }
    this.store.setNextRunAt(automation.id, null);
  }

  private catchUpMissed(): void {
    if (this.store.getPaused()) return;
    const now = this.now();
    for (const automation of this.automations) {
      if (!this.isEnabled(automation)) continue;
      if (automation.resolvedCatchUp === "none") continue;
      // Only catch up when durable prior scheduling state proves prior arming.
      // armFirstSeenSchedule already initialized brand-new rows in this pass;
      // those must not catch up. Detect "previously running" via last_claimed
      // that was set in a prior session before this process armed — for rows we
      // just armed, last_claimed equals the acknowledged historical due and
      // latestDue == last_claimed so the due check below no-ops.
      if (!this.store.wasSchedulePreviouslyInitialized(automation.id)) continue;

      if (automation.trigger.type === "cron") {
        const due = latestDueCronOccurrenceMs(
          automation.trigger.expr,
          automation.resolvedTimezone,
          now,
        );
        if (due === null) continue;
        const state = this.store.getAutomationState(automation.id);
        if (state?.last_claimed_occurrence_ms != null && state.last_claimed_occurrence_ms >= due) {
          continue;
        }
        // Require prior claim evidence: null last_claimed on an initialized row
        // can only happen if state was corrupted; still do not invent history
        // from before initialization.
        if (state?.last_claimed_occurrence_ms == null) continue;
        if (due <= now && due > state.last_claimed_occurrence_ms) {
          void this.enqueueTimeOccurrence(automation, due, "cron", false);
        }
        continue;
      }
      if (automation.trigger.type === "interval") {
        const state = this.store.getAutomationState(automation.id);
        if (state?.last_claimed_occurrence_ms == null) continue;
        const due = latestMissedIntervalOccurrenceMs(
          automation.trigger.every,
          state.last_claimed_occurrence_ms,
          now,
        );
        if (due !== null) {
          void this.enqueueTimeOccurrence(automation, due, "interval", false);
        }
      }
    }
    this.pump();
  }

  tick(now = this.now()): void {
    if (this.stopped || this.store.getPaused()) return;
    for (const automation of this.automations) {
      if (!this.isEnabled(automation)) continue;
      if (automation.trigger.type === "cron") {
        if (!this.store.wasSchedulePreviouslyInitialized(automation.id)) continue;
        const due = latestDueCronOccurrenceMs(
          automation.trigger.expr,
          automation.resolvedTimezone,
          now,
        );
        if (due === null || due > now) continue;
        const state = this.store.getAutomationState(automation.id);
        if (state?.last_claimed_occurrence_ms != null && state.last_claimed_occurrence_ms >= due) {
          this.refreshNextRun(automation);
          continue;
        }
        // First-seen arming sets last_claimed to historical due; only fire new dues.
        if (state?.last_claimed_occurrence_ms == null) continue;
        void this.enqueueTimeOccurrence(automation, due, "cron", false);
        continue;
      }
      if (automation.trigger.type === "interval") {
        if (!this.store.wasSchedulePreviouslyInitialized(automation.id)) continue;
        const state = this.store.getAutomationState(automation.id);
        if (state?.last_claimed_occurrence_ms == null) continue;
        const next = nextIntervalRunMs(
          automation.trigger.every,
          state.last_claimed_occurrence_ms,
          now,
        );
        if (next <= now) {
          const occurrence =
            latestMissedIntervalOccurrenceMs(
              automation.trigger.every,
              state.last_claimed_occurrence_ms,
              now,
            ) ?? now;
          void this.enqueueTimeOccurrence(automation, occurrence, "interval", false);
        } else {
          this.store.setNextRunAt(automation.id, next);
        }
      }
    }
    this.pump();
  }

  handleEvent(eventType: string, payload: unknown): void {
    if (this.stopped || this.store.getPaused()) return;
    const normalized = normalizeHerdrEvent(payload);
    const type = eventType || normalized.event;
    const matchPayload = {
      type,
      event: type,
      data: normalized.data,
      id: normalized.envelope.id,
      event_id: normalized.envelope.event_id,
      seq: normalized.envelope.seq,
      revision: normalized.envelope.revision,
    };
    const receivedAt = Date.now();
    for (const automation of this.automations) {
      if (!this.isEnabled(automation)) continue;
      if (automation.trigger.type !== "event") continue;
      if (automation.trigger.event !== type) continue;
      if (!eventMatches(automation.trigger.match, matchPayload)) continue;
      const token = eventDedupeToken(matchPayload, receivedAt);
      const occurrenceKey = eventOccurrenceKey(automation.id, type, token);
      void this.enqueueClaimed(automation, occurrenceKey, "event", false, null);
    }
    this.pump();
  }

  async runNow(automationId: string): Promise<{ runId: string } | { error: string }> {
    const automation = this.automations.find((item) => item.id === automationId);
    if (!automation) return { error: `unknown automation "${automationId}"` };
    const occurrenceKey = `manual:${automationId}:${this.now()}:${crypto.randomUUID()}`;
    const runId = await this.enqueueClaimed(automation, occurrenceKey, "manual", true, null);
    if (!runId) return { error: "failed to claim manual run" };
    this.pump();
    return { runId };
  }

  async retry(automationId: string): Promise<{ runId: string } | { error: string }> {
    const latest = this.store.latestRun(automationId);
    if (!latest) return { error: "no prior run to retry" };
    if (
      !["failed", "interrupted_unknown", "skipped_overlap", "cancelled"].includes(latest.status)
    ) {
      return { error: `latest run status is ${latest.status}; retry not required` };
    }
    return this.runNow(automationId);
  }

  /**
   * Cancel the latest queued run for an automation.
   * Executing runs are not interrupted (unsafe); returns a clear error instead.
   */
  cancel(automationId: string): { runId: string } | { error: string } {
    const automation = this.automations.find((item) => item.id === automationId);
    if (!automation) return { error: `unknown automation "${automationId}"` };

    const queued = this.store.latestQueuedRun(automationId);
    if (!queued) {
      if (this.running.has(automationId) || this.store.hasRunningRun(automationId)) {
        return {
          error:
            "run is already executing and cannot be cancelled safely (queued runs only; no interrupt)",
        };
      }
      return { error: "no queued run to cancel" };
    }

    const idx = this.queue.findIndex((job) => job.runId === queued.id);
    if (idx >= 0) this.queue.splice(idx, 1);

    this.store.updateRun(queued.id, {
      status: "cancelled",
      finished_at: this.now(),
      summary: "status=cancelled",
      error: "cancelled while queued",
    });
    return { runId: queued.id };
  }

  private async enqueueTimeOccurrence(
    automation: ResolvedAutomation,
    occurrenceMs: number,
    kind: "cron" | "interval",
    manual: boolean,
  ): Promise<void> {
    if (this.stopped) return;
    const occurrenceKey =
      kind === "cron"
        ? cronOccurrenceKey(automation.id, occurrenceMs)
        : intervalOccurrenceKey(automation.id, occurrenceMs);
    await this.enqueueClaimed(automation, occurrenceKey, kind, manual, occurrenceMs);
    if (!this.stopped) this.refreshNextRun(automation);
  }

  private async enqueueClaimed(
    automation: ResolvedAutomation,
    occurrenceKey: string,
    triggerKind: string,
    manual: boolean,
    occurrenceMs: number | null,
  ): Promise<string | null> {
    if (!manual && this.store.countActiveForAutomation(automation.id) > 0) {
      if (automation.resolvedOverlap === "skip") {
        const skipId = crypto.randomUUID();
        const claimed = this.store.tryClaimOccurrence({
          occurrenceKey,
          automationId: automation.id,
          runId: skipId,
          claimedAt: this.now(),
        });
        if (claimed) {
          if (occurrenceMs !== null) {
            this.store.setLastClaimedOccurrenceMs(automation.id, occurrenceMs);
          }
          const ts = this.now();
          this.store.insertRun({
            id: skipId,
            automation_id: automation.id,
            occurrence_key: occurrenceKey,
            trigger_kind: triggerKind,
            status: "skipped_overlap",
            started_at: ts,
            finished_at: ts,
            summary: "status=skipped_overlap",
            error: null,
            manual: 0,
            created_at: ts,
          });
          this.store.updateRun(skipId, {
            status: "skipped_overlap",
            finished_at: ts,
            summary: "status=skipped_overlap",
          });
        }
        return null;
      }
    }

    const runId = crypto.randomUUID();
    const claimed = this.store.tryClaimOccurrence({
      occurrenceKey,
      automationId: automation.id,
      runId,
      claimedAt: this.now(),
    });
    if (!claimed) return null;
    if (occurrenceMs !== null) {
      this.store.setLastClaimedOccurrenceMs(automation.id, occurrenceMs);
    }
    this.store.insertRun({
      id: runId,
      automation_id: automation.id,
      occurrence_key: occurrenceKey,
      trigger_kind: triggerKind,
      status: "queued",
      started_at: null,
      finished_at: null,
      summary: null,
      error: null,
      manual: manual ? 1 : 0,
      created_at: this.now(),
    });
    this.queue.push({
      runId,
      automationId: automation.id,
      execute: () => this.executeRun(automation, runId),
    });
    return runId;
  }

  private pump(): void {
    while (this.activeCount < GLOBAL_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.activeCount += 1;
      void job.execute().finally(() => {
        this.activeCount -= 1;
        this.pump();
      });
    }
  }

  private async executeRun(automation: ResolvedAutomation, runId: string): Promise<void> {
    const current = this.store.getRun(runId);
    if (!current || current.status === "cancelled") return;
    if (this.stopped) {
      this.store.updateRun(runId, {
        status: "cancelled",
        finished_at: this.now(),
        summary: "status=cancelled",
      });
      return;
    }
    if (current.status !== "queued") return;
    if (this.running.has(automation.id)) {
      const ts = this.now();
      this.store.updateRun(runId, {
        status: "skipped_overlap",
        started_at: ts,
        finished_at: ts,
        summary: "status=skipped_overlap",
      });
      return;
    }
    this.running.add(automation.id);
    this.store.updateRun(runId, { status: "running", started_at: this.now() });
    try {
      const result = await this.executor({
        automationId: automation.id,
        cwd: automation.cwd,
        action: automation.action,
        timeoutSeconds: automation.resolvedTimeoutSeconds,
      });
      if (!this.stopped) {
        this.store.updateRun(runId, {
          status: result.status,
          finished_at: this.now(),
          summary: result.summary,
          error: result.error,
        });
      }
    } catch (error) {
      if (!this.stopped) {
        this.store.updateRun(runId, {
          status: "failed",
          finished_at: this.now(),
          summary: "status=failed",
          error: sanitizeError(error),
        });
      }
    } finally {
      this.running.delete(automation.id);
      if (!this.stopped) this.refreshNextRun(automation);
    }
  }

  snapshot(): SchedulerSnapshotItem[] {
    return this.automations.map((automation) => {
      const state = this.store.getAutomationState(automation.id);
      const trigger =
        automation.trigger.type === "cron"
          ? `cron ${automation.trigger.expr} (${automation.resolvedTimezone})`
          : automation.trigger.type === "interval"
            ? `every ${automation.trigger.every}`
            : `event ${automation.trigger.event}`;
      return {
        id: automation.id,
        name: automation.displayName,
        enabled: this.isEnabled(automation),
        trigger,
        nextRunAt: state?.next_run_at ?? null,
        lastStatus: state?.last_status ?? null,
        lastFinishedAt: state?.last_finished_at ?? null,
        running: this.running.has(automation.id),
      };
    });
  }
}
