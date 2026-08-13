import { z } from "zod";
import { DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEZONE } from "../constants.ts";
import { parseDurationToMs } from "../util/time.ts";

const idSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, "id must match [a-z][a-z0-9_-]{0,63}");

const absolutePath = z.string().refine((value) => value.startsWith("/"), {
  message: "cwd must be an absolute path",
});

const cronExpr = z
  .string()
  .regex(
    /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/,
    "cron expr must have exactly five fields: minute hour day month weekday",
  );

const duration = z.string().superRefine((value, ctx) => {
  try {
    parseDurationToMs(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export const cronTriggerSchema = z.object({
  type: z.literal("cron"),
  expr: cronExpr,
  timezone: z.string().min(1).optional(),
});

export const intervalTriggerSchema = z.object({
  type: z.literal("interval"),
  every: duration,
});

export const eventTriggerSchema = z.object({
  type: z.literal("event"),
  event: z.string().min(1),
  match: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const triggerSchema = z.discriminatedUnion("type", [
  cronTriggerSchema,
  intervalTriggerSchema,
  eventTriggerSchema,
]);

export const commandActionSchema = z.object({
  type: z.literal("command"),
  command: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  env: z.record(z.string(), z.string()).default({}),
  timeout_seconds: z.number().int().positive().max(86_400).optional(),
});

export const agentActionSchema = z.object({
  type: z.literal("agent"),
  kind: z.string().min(1),
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, "agent name must match [a-z][a-z0-9_-]{0,31}"),
  prompt: z.string().min(1),
  timeout_seconds: z.number().int().positive().max(86_400).optional(),
});

export const actionSchema = z.discriminatedUnion("type", [commandActionSchema, agentActionSchema]);

export const automationSchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
  cwd: absolutePath,
  trigger: triggerSchema,
  action: actionSchema,
  overlap: z.enum(["skip"]).default("skip"),
  catch_up: z.enum(["latest", "none"]).default("latest"),
  timezone: z.string().min(1).optional(),
  timeout_seconds: z.number().int().positive().max(86_400).optional(),
});

export const defaultsSchema = z.object({
  timezone: z.string().min(1).default(DEFAULT_TIMEZONE),
  overlap: z.enum(["skip"]).default("skip"),
  catch_up: z.enum(["latest", "none"]).default("latest"),
  timeout_seconds: z.number().int().positive().max(86_400).default(DEFAULT_TIMEOUT_SECONDS),
});

export const rootConfigSchema = z.object({
  version: z.literal(1),
  defaults: defaultsSchema.default({
    timezone: DEFAULT_TIMEZONE,
    overlap: "skip",
    catch_up: "latest",
    timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
  }),
  automations: z.array(automationSchema).default([]),
});

export type RootConfig = z.infer<typeof rootConfigSchema>;
export type AutomationConfig = z.infer<typeof automationSchema>;
export type TriggerConfig = z.infer<typeof triggerSchema>;
export type ActionConfig = z.infer<typeof actionSchema>;
export type DefaultsConfig = z.infer<typeof defaultsSchema>;

export type ResolvedAutomation = AutomationConfig & {
  displayName: string;
  resolvedTimezone: string;
  resolvedTimeoutSeconds: number;
  resolvedOverlap: "skip";
  resolvedCatchUp: "latest" | "none";
};

export function resolveAutomation(
  automation: AutomationConfig,
  defaults: DefaultsConfig,
): ResolvedAutomation {
  const timezone =
    automation.timezone ??
    (automation.trigger.type === "cron" ? automation.trigger.timezone : undefined) ??
    defaults.timezone;
  return {
    ...automation,
    displayName: automation.name ?? automation.id,
    resolvedTimezone: timezone,
    resolvedTimeoutSeconds:
      automation.timeout_seconds ??
      (automation.action.type === "command" || automation.action.type === "agent"
        ? (automation.action.timeout_seconds ?? defaults.timeout_seconds)
        : defaults.timeout_seconds),
    resolvedOverlap: automation.overlap ?? defaults.overlap,
    resolvedCatchUp: automation.catch_up ?? defaults.catch_up,
  };
}
