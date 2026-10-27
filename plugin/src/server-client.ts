// Server-mode client: JSON-RPC over WebSocket against a Leassh server
// (connectors program T4). Same dialect as the stdio transport — the
// server dispatches both identically — with `hello` token auth and
// correlation ids. Uses the built-in WebSocket (Node >= 21), zero deps.

import { EventEmitter } from "events";

interface JsonRpcFrame {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

export class FleetServerClient extends EventEmitter {
  private serverUrl: string;
  private token: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending: Map<number, Pending> = new Map();
  private stopping = false;
  private reconnectDelay = RECONNECT_MIN_MS;

  constructor(serverUrl: string, token: string) {
    super();
    this.serverUrl = serverUrl.replace(/\/$/, "");
    this.token = token;
  }

  /** ws:// or wss:// form of the server URL + WS path. */
  private wsUrl(): string {
    const u = new URL(this.serverUrl);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/api/ws";
    return u.toString();
  }

  start(): void {
    this.stopping = false;
    this.connect();
  }

  stop(): void {
    this.stopping = true;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.stopping) return;
    const ws = new WebSocket(this.wsUrl());
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.emit("log", `connected to ${this.serverUrl}, authenticating`);
      // hello with the openclaw-scope token; the response carries the
      // protocol version and heartbeat cadence.
      this.rawCall("hello", { protocol_version: 1, token: this.token })
        .then((welcome: any) => {
          this.reconnectDelay = RECONNECT_MIN_MS;
          this.emit("log", `authenticated: scope=${welcome?.scope}`);
        })
        .catch((e: Error) => {
          this.emit("log", `hello failed: ${e.message}`);
          ws.close();
        });
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      let frame: JsonRpcFrame;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return; // non-JSON frames are not part of the dialect
      }
      if (frame.id !== undefined && this.pending.has(frame.id)) {
        const p = this.pending.get(frame.id)!;
        clearTimeout(p.timer);
        this.pending.delete(frame.id);
        if (frame.error) {
          p.reject(new Error(frame.error.message));
        } else {
          p.resolve(frame.result);
        }
        return;
      }
      if (frame.method === "leassh_event") {
        const params: any = frame.params ?? {};
        this.emit("event", params.kind ?? "unknown", params.data ?? {});
      }
    });

    ws.addEventListener("close", () => {
      if (this.stopping) return;
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
      this.emit("log", `connection lost; reconnecting in ${delay}ms`);
      setTimeout(() => this.connect(), delay);
    });
  }

  private rawCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`not connected to Leassh server (${this.serverUrl})`));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }));
    });
  }

  /** Any dialect method (get_fleet_status, get_node_detail, ...). */
  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.rawCall(method, params);
  }

  async getFleetStatus(): Promise<unknown> {
    return this.rawCall("get_fleet_status");
  }

  async getNodeDetail(node: string): Promise<unknown> {
    return this.rawCall("get_node_detail", { node });
  }

  /**
   * Standalone-only metric: value_gap is computed by the bundled binary's
   * own tracker. In server mode the Leassh server is the sole authority
   * (connectors plan §0.1) and does not expose this derived view, so the
   * tool reports the capability boundary instead of duplicating the math.
   */
  async getValueGap(): Promise<unknown> {
    throw new Error(
      "get_value_gap is standalone-only; server mode reads fleet truth from the Leassh server (get_fleet_status / get_node_detail)"
    );
  }
}
