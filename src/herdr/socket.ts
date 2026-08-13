import { createConnection, type Socket } from "node:net";
import { herdrSocketPath } from "../util/paths.ts";

export type HerdrSocketMessage = Record<string, unknown>;

export class HerdrSocket {
  private socket: Socket | null = null;
  private buffer = "";
  private pending = new Map<
    string,
    { resolve: (value: HerdrSocketMessage) => void; reject: (error: Error) => void }
  >();
  private eventHandlers = new Set<(event: HerdrSocketMessage) => void>();
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly path: string;
  private readonly onClose: (() => void) | null;

  constructor(path = herdrSocketPath(), onClose: (() => void) | null = null) {
    if (!path) throw new Error("HERDR_SOCKET_PATH is not set");
    this.path = path;
    this.onClose = onClose;
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.path);
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        this.socket = socket;
        this.closed = false;
        resolve();
      });
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("error", (error) => {
        if (!this.socket) reject(error);
        else this.failPending(error);
      });
      socket.on("close", () => {
        this.socket = null;
        this.failPending(new Error("herdr socket closed"));
        this.onClose?.();
        if (!this.closed) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, 1000);
  }

  private failPending(error: Error): void {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: HerdrSocketMessage;
    try {
      message = JSON.parse(line) as HerdrSocketMessage;
    } catch {
      return;
    }
    const id = typeof message.id === "string" ? message.id : null;
    if (id && this.pending.has(id)) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.resolve(message);
      return;
    }
    // Subscription push events typically have method/type and no matching pending id.
    for (const handler of this.eventHandlers) handler(message);
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 5_000,
  ): Promise<HerdrSocketMessage> {
    if (!this.socket) await this.connect();
    const id = `req_${crypto.randomUUID()}`;
    const payload = `${JSON.stringify({ id, method, params })}\n`;
    return await new Promise<HerdrSocketMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`herdr socket ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket?.write(payload, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async subscribe(
    subscriptions: Array<Record<string, unknown>>,
    onEvent: (event: HerdrSocketMessage) => void,
  ): Promise<HerdrSocketMessage> {
    this.eventHandlers.add(onEvent);
    return await this.request("events.subscribe", { subscriptions });
  }

  onEvent(handler: (event: HerdrSocketMessage) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
    this.socket = null;
  }
}
