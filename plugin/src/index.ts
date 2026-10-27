// OpenClaw plugin API types -- using 'any' until SDK package is available

import * as path from "path";
import * as fs from "fs";
import { FleetBinary } from "./ipc-client";
import { FleetServerClient } from "./server-client";
import { probeForLeasshServer } from "./mdns-probe";
import { registerTools } from "./tools";

const DASHBOARD_PATH = path.resolve(__dirname, "..", "assets", "dashboard.html");

/**
 * The fleet connection. Standalone spawns the bundled binary (stdio
 * JSON-RPC); server pairs with a Leassh server over WS using the same
 * dialect (connectors plan §0.2 — one dialect, multiple transports).
 */
type Fleet = FleetBinary | FleetServerClient;

function resolveMode(api: any): { mode: "standalone" | "server"; serverUrl?: string; apiToken?: string } {
  // Env overrides win (LEASSH_SERVER_URL present => server mode), then
  // explicit plugin config, then configPath-only => standalone (back-compat).
  const envUrl = process.env.LEASSH_SERVER_URL;
  if (envUrl) {
    const token = process.env.LEASSH_API_TOKEN;
    if (!token) {
      throw new Error(
        "LEASSH_SERVER_URL is set but LEASSH_API_TOKEN is missing — server mode needs both"
      );
    }
    return { mode: "server", serverUrl: envUrl, apiToken: token };
  }
  const cfg = api.pluginConfig ?? {};
  if (cfg.mode === "server") {
    if (!cfg.serverUrl || !cfg.apiToken) {
      throw new Error(
        "mode 'server' requires serverUrl and apiToken (an openclaw-scope token minted on the Leassh server)"
      );
    }
    return { mode: "server", serverUrl: cfg.serverUrl, apiToken: cfg.apiToken };
  }
  return { mode: "standalone" };
}

export default {
  id: "openclaw-fleet",
  name: "Fleet Monitor",

  register(api: any): void {
    const resolved = resolveMode(api);

    let fleet: Fleet;
    if (resolved.mode === "server") {
      fleet = new FleetServerClient(resolved.serverUrl!, resolved.apiToken!);
      api.log?.(`[openclaw-fleet] server mode: ${resolved.serverUrl}`);
    } else {
      // configPath-only keeps standalone meaning (v0.1.x back-compat).
      const configPath: string =
        api.pluginConfig?.configPath ||
        path.join(process.cwd(), "fleet.yaml");
      fleet = new FleetBinary(configPath);
    }

    // Register tools (fleet_status, node_detail, get_value_gap) — identical
    // surface in both modes; the transport is not the tools' business.
    registerTools(api, fleet);

    // --- Gateway-authenticated HTTP routes ---

    if (typeof api.registerHttpRoute !== "function") {
      throw new Error(
        "OpenClaw Fleet requires an OpenClaw version with authenticated registerHttpRoute support"
      );
    }

    // Serve the dashboard HTML
    api.registerHttpRoute({
      path: "/fleet",
      auth: "gateway",
      handler: (_req: any, res: any) => {
        try {
          const html = fs.readFileSync(DASHBOARD_PATH, "utf-8");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.end(html);
        } catch (err: any) {
          res.statusCode = 500;
          res.end(`Dashboard not found: ${err.message}`);
        }
      },
    });

    // JSON API endpoint for the dashboard
    api.registerHttpRoute({
      path: "/fleet/api/status",
      auth: "gateway",
      handler: async (_req: any, res: any) => {
        try {
          const status = await fleet.getFleetStatus();
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(status));
        } catch (err: any) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ error: err.message }));
        }
      },
    });

    // --- Background service: transport lifecycle with the plugin ---

    api.registerService({
      name: "openclaw-fleet-connection",
      start: async () => {
        fleet.start();
        fleet.on("log", (msg: string) => {
          api.log?.("[openclaw-fleet]", msg);
        });
        fleet.on("event", (method: string, params: unknown) => {
          api.log?.("[openclaw-fleet event]", method, params);
        });
        fleet.on("exit", (code: number | null, signal: string | null) => {
          api.log?.(`[openclaw-fleet] transport exited code=${code} signal=${signal}`);
        });

        // Split-brain guard (standalone only): if a Leassh server is
        // already answering on this LAN, say so and point at it instead of
        // silently running a second, diverging authority.
        if (resolved.mode === "standalone") {
          try {
            const found = await probeForLeasshServer(2000);
            if (found) {
              api.log?.(
                `[openclaw-fleet] WARNING: a Leassh server appears to be running on this LAN ` +
                  `(port ${found.apiPort ?? found.port}). Running standalone alongside it risks ` +
                `split-brain fleet state. Consider mode:"server" with serverUrl http://<host>:${found.apiPort ?? found.port}.`
              );
            }
          } catch {
            /* probing is best-effort; never block startup */
          }
        }
      },
      stop: () => {
        fleet.stop();
      },
    });
  },
};
