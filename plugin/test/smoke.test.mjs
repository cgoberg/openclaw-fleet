#!/usr/bin/env node
/**
 * Release smoke test for the openclaw-fleet plugin.
 *
 * Verifies, without touching anything outside a temp dir:
 *   1. package.json / openclaw.plugin.json / skills/SKILL.md versions are aligned
 *   2. openclaw.plugin.json satisfies the required manifest contract fields (id, configSchema)
 *   3. registered tools match contracts.tools in the manifest
 *   4. the dashboard route serves HTML and /fleet/api/status returns valid fleet JSON
 *      from a freshly spawned Rust binary against an empty fleet config
 *
 * Requires: `npm run build` and `cargo build --release` (or OPENCLAW_FLEET_BINARY set).
 */
import { createRequire } from "node:module";
import {
  accessSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const PLUGIN_ROOT = resolve(new URL("..", import.meta.url).pathname);
const REPO_ROOT = resolve(PLUGIN_ROOT, "..");

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// --- 1. Version alignment ---------------------------------------------------
const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, "package.json"), "utf-8"));
const manifest = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, "openclaw.plugin.json"), "utf-8")
);
const skill = readFileSync(join(PLUGIN_ROOT, "skills", "SKILL.md"), "utf-8");
const dashboard = readFileSync(join(PLUGIN_ROOT, "assets", "dashboard.html"), "utf-8");

check("package.json version is 0.1.3", pkg.version === "0.1.3", pkg.version);
check("manifest version is 0.1.3", manifest.version === "0.1.3", manifest.version);
check(
  "SKILL.md frontmatter version is 0.1.3",
  /^version:\s*0\.1\.3$/m.test(skill),
  "version field mismatch"
);

// --- 2. Manifest contract ----------------------------------------------------
check("manifest has canonical id 'openclaw-fleet'", manifest.id === "openclaw-fleet");
check(
  "manifest declares configSchema (required)",
  manifest.configSchema?.type === "object",
  JSON.stringify(manifest.configSchema)
);
check("manifest id matches package name", manifest.id === pkg.name);
check("dashboard contains no inline event handlers", !/<[^>]+\son[a-z]+\s*=/i.test(dashboard));
check(
  "dashboard binds node clicks without interpolating JavaScript",
  dashboard.includes("node.addEventListener('click'")
);

const declaredTools = manifest.contracts?.tools ?? [];
const expectedTools = ["fleet_status", "node_detail", "get_value_gap"];
check(
  "contracts.tools covers all three tools",
  expectedTools.every((t) => declaredTools.includes(t)),
  JSON.stringify(declaredTools)
);

// --- 3. Register against a stub host API -------------------------------------
const routes = new Map();
const tools = [];
let service = null;

// Empty fleet config in a temp dir: exercises real IPC without probing anything.
const tmp = mkdtempSync(join(tmpdir(), "openclaw-fleet-smoke-"));
const fleetYaml = join(tmp, "fleet.yaml");
writeFileSync(fleetYaml, "nodes: []\n");

const api = {
  pluginConfig: { configPath: fleetYaml },
  log: () => {},
  registerHttpRoute: (route) => routes.set(`GET ${route.path}`, route),
  registerTool: (tool) => tools.push(tool.name),
  registerService: (svc) => {
    service = svc;
  },
};

const plugin = require(join(PLUGIN_ROOT, "dist", "index.js"));
plugin.default.register(api);

check(
  "runtime registers exactly the declared tools",
  tools.length === expectedTools.length && expectedTools.every((t) => tools.includes(t)),
  `registered=${JSON.stringify(tools)}`
);
check("registers GET /fleet dashboard route", routes.has("GET /fleet"));
check("registers GET /fleet/api/status route", routes.has("GET /fleet/api/status"));
check(
  "dashboard routes require gateway authentication",
  routes.get("GET /fleet")?.auth === "gateway" &&
    routes.get("GET /fleet/api/status")?.auth === "gateway"
);
check("registers background service", service !== null);

// --- 4. Dashboard + status API against the real binary ------------------------
const candidates = process.env.OPENCLAW_FLEET_BINARY
  ? [process.env.OPENCLAW_FLEET_BINARY]
  : [
      join(REPO_ROOT, "binary", "target", "release", "openclaw-fleet"),
      join(REPO_ROOT, "binary", "target", "debug", "openclaw-fleet"),
    ];
const binPath = candidates.find((p) => {
  try {
    accessSync(p);
    return true;
  } catch {
    return false;
  }
});

if (!binPath) {
  check(
    "fleet binary found (build with cargo build --release)",
    false,
    `looked in: ${candidates.join(", ")}`
  );
} else {
  process.env.OPENCLAW_FLEET_BINARY = binPath;

  try {
    service.start();
    // Give the binary a moment to boot.
    await new Promise((r) => setTimeout(r, 300));

    let html = "";
    let htmlStatus = 200;
    await routes.get("GET /fleet").handler(
      {},
      {
        setHeader: () => {},
        statusCode: 200,
        end: (body) => {
          html = body;
        },
      }
    );
    check("dashboard serves HTML", htmlStatus === 200 && html.includes("<title>openclaw-fleet</title>"), `len=${html.length}`);

    let rawStatus = "";
    let apiStatus = 200;
    await routes.get("GET /fleet/api/status").handler(
      {},
      {
        setHeader: () => {},
        statusCode: 200,
        end: (body) => {
          rawStatus = body;
        },
      }
    );
    const status = JSON.parse(rawStatus);
    check(
      "status API returns empty fleet",
      apiStatus === 200 &&
        Array.isArray(status.nodes) &&
        status.nodes.length === 0 &&
        status.total === 0,
      rawStatus.slice(0, 120)
    );
  } finally {
    service.stop();
    await new Promise((r) => setTimeout(r, 100));
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? "\nsmoke test: PASS" : `\nsmoke test: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
