import { herdrBin } from "../util/paths.ts";
import { redactString } from "../util/redaction.ts";

export type HerdrResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  json: unknown | null;
};

export async function herdr(
  args: string[],
  options: { timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<HerdrResult> {
  const bin = herdrBin();
  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env },
  });

  const timeoutMs = options.timeoutMs ?? 15_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const [stdout, stderr, status] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  let json: unknown | null = null;
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      json = null;
    }
  }

  if (timedOut) {
    return {
      ok: false,
      status: status === 0 ? 124 : status,
      stdout,
      stderr: stderr || `herdr timed out after ${timeoutMs}ms`,
      json,
    };
  }

  return {
    ok: status === 0,
    status,
    stdout,
    stderr,
    json,
  };
}

export function herdrErrorMessage(result: HerdrResult): string {
  if (result.json && typeof result.json === "object") {
    const record = result.json as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") return redactString(message);
    }
  }
  const text = result.stderr.trim() || result.stdout.trim() || `herdr exit ${result.status}`;
  return redactString(text);
}
