import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { controlSockPath } from "../util/paths.ts";
import { assertUnixSocketPathLength } from "../util/socket-path.ts";

export type ControlRequest = {
  id?: string;
  method: string;
  params?: Record<string, unknown>;
};

export type ControlResponse = {
  id?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type ControlHandler = (
  request: ControlRequest,
) => Promise<ControlResponse> | ControlResponse;

export class ControlServer {
  private server: Server | null = null;
  private readonly path: string;
  private readonly handler: ControlHandler;

  constructor(handler: ControlHandler, path = controlSockPath()) {
    this.handler = handler;
    this.path = path;
  }

  async start(): Promise<void> {
    assertUnixSocketPathLength(this.path);
    if (existsSync(this.path)) {
      try {
        unlinkSync(this.path);
      } catch {
        // ignore
      }
    }
    this.server = createServer((socket) => this.onConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.path, () => {
        try {
          chmodSync(this.path, 0o600);
        } catch {
          // ignore
        }
        resolve();
      });
    });
  }

  private onConnection(socket: Socket): void {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) void this.handleLine(socket, line);
        index = buffer.indexOf("\n");
      }
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: ControlRequest;
    try {
      request = JSON.parse(line) as ControlRequest;
    } catch {
      socket.write(`${JSON.stringify({ ok: false, error: "invalid json" })}\n`);
      return;
    }
    try {
      const response = await this.handler(request);
      socket.write(`${JSON.stringify({ id: request.id, ...response })}\n`);
    } catch (error) {
      socket.write(
        `${JSON.stringify({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}\n`,
      );
    }
  }

  close(): void {
    this.server?.close();
    this.server = null;
    try {
      if (existsSync(this.path)) unlinkSync(this.path);
    } catch {
      // ignore
    }
  }
}

export async function controlRequest(
  method: string,
  params: Record<string, unknown> = {},
  path = controlSockPath(),
  timeoutMs = 2_000,
): Promise<ControlResponse> {
  const id = crypto.randomUUID();
  const payload = `${JSON.stringify({ id, method, params })}\n`;

  return await new Promise<ControlResponse>((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`controlRequest ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(payload);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      const line = buffer.slice(0, index).trim();
      socket.end();
      finish(() => {
        try {
          resolve(JSON.parse(line) as ControlResponse);
        } catch (error) {
          reject(error);
        }
      });
    });
    socket.once("error", (error) => {
      finish(() => reject(error));
    });
  });
}
