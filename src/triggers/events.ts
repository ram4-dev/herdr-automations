export type MatchFilter = Record<string, string | number | boolean | null>;

export type NormalizedHerdrEvent = {
  event: string;
  data: Record<string, unknown>;
  envelope: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function flatten(
  value: unknown,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, path, out);
    } else {
      out[path] = child;
    }
  }
  return out;
}

/**
 * Normalize Herdr subscription envelopes to `{ event, data }` so YAML match
 * filters can target payload fields like `agent_status: blocked` without
 * requiring a `data.` prefix.
 */
export function normalizeHerdrEvent(message: unknown): NormalizedHerdrEvent {
  const envelope = asRecord(message) ?? {};
  const event =
    typeof envelope.type === "string"
      ? envelope.type
      : typeof envelope.event === "string"
        ? envelope.event
        : typeof envelope.method === "string"
          ? envelope.method
          : "";
  const data = asRecord(envelope.data) ?? {};
  return { event, data, envelope };
}

export function eventMatches(filter: MatchFilter, payload: unknown): boolean {
  const normalized = normalizeHerdrEvent(payload);
  const flat: Record<string, unknown> = {
    ...flatten(normalized.data),
    ...flatten(normalized.data, "data"),
    event: normalized.event,
    type: normalized.event,
  };

  for (const [key, expected] of Object.entries(filter)) {
    if (!(key in flat)) return false;
    if (flat[key] !== expected) return false;
  }
  return true;
}

export function eventOccurrenceKey(
  automationId: string,
  eventType: string,
  dedupeToken: string,
): string {
  return `event:${automationId}:${eventType}:${dedupeToken}`;
}

export function eventDedupeToken(payload: unknown, receivedAtMs: number): string {
  const normalized = normalizeHerdrEvent(payload);
  const envelope = normalized.envelope;
  const candidates = [envelope.id, envelope.event_id, envelope.seq, envelope.revision];
  for (const candidate of candidates) {
    if (typeof candidate === "string" || typeof candidate === "number") {
      return String(candidate);
    }
  }
  const pane = normalized.data.pane_id ?? normalized.data.workspace_id;
  const status = normalized.data.agent_status ?? normalized.data.status;
  if (pane !== undefined || status !== undefined) {
    return `${String(pane ?? "")}:${String(status ?? "")}:${receivedAtMs}`;
  }
  return `ts:${receivedAtMs}`;
}
