const SECRET_KEY =
  /^(.*_)?(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|credential)s?$/i;

const SECRET_VALUE =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})\b/gi;

export function redactString(input: string, maxLen = 500): string {
  const scrubbed = input.replace(SECRET_VALUE, "[REDACTED]");
  if (scrubbed.length <= maxLen) return scrubbed;
  return `${scrubbed.slice(0, maxLen)}…`;
}

export function redactEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactString(value, 120);
  }
  return out;
}

export function sanitizeError(error: unknown): string {
  if (error instanceof Error) return redactString(error.message);
  return redactString(String(error));
}

export function sanitizeHistorySummary(input: {
  exitCode?: number | null;
  status: string;
  detail?: string;
}): string {
  const parts = [`status=${input.status}`];
  if (input.exitCode !== undefined && input.exitCode !== null) {
    parts.push(`exit=${input.exitCode}`);
  }
  if (input.detail) parts.push(redactString(input.detail, 240));
  return parts.join(" ");
}
