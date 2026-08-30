# Release: v0.1.2

Status: **security hardening release** for OpenClaw Fleet by Leassh.

## Version alignment

One version everywhere, `0.1.2`:

| File | Field |
|---|---|
| `plugin/package.json` | `version` |
| `plugin/openclaw.plugin.json` | `version` |
| `binary/Cargo.toml` (+ `Cargo.lock`) | `version` |
| `plugin/skills/SKILL.md` | frontmatter `version` |

## OpenClaw plugin contract (verified against docs.openclaw.ai/plugins)

- `openclaw.plugin.json` ships required `id` and `configSchema`; config schema
  is closed (`additionalProperties: false`) with the optional `configPath`
  property.
- All runtime tools (`fleet_status`, `node_detail`, `get_value_gap`) are declared
  in `contracts.tools` so discovery owns them without loading plugin code.
- Runtime entry points are declared in `package.json` under `openclaw.extensions`
  (source) and `openclaw.runtimeExtensions` (built JS in `dist/`). The
  undocumented `entrypoint` manifest field was removed.
- Skill root declared via `skills: ["skills/"]`.

## Install command (documented behavior)

v0.1.2 is source-first; the Quick Start builds both artifacts and installs from
the local checkout:

```bash
openclaw plugins install --link ./plugin
```

Bare-spec installs (`openclaw plugins install openclaw-fleet`) become valid once
the package exists on ClawHub/npm — R2 concern. The plugin resolves its Rust
binary via `OPENCLAW_FLEET_BINARY`, falling back to repo-relative
`binary/target/{release,debug}/openclaw-fleet`.

## Smoke test

```bash
cargo build --release --manifest-path binary/Cargo.toml
cd plugin && npm ci && npm run build && npm test
```

`plugin/test/smoke.test.mjs` verifies version alignment, manifest contract
fields, tool registration vs `contracts.tools`, dashboard HTML serving, and a
live `/fleet/api/status` round-trip against a freshly spawned binary with an
empty fleet (`nodes: []`). It writes only to a temp dir.

## Build release artifacts + checksums (local only)

```bash
scripts/package-release.sh
```

Produces `release/v0.1.2/` (gitignored):

- `openclaw-fleet-plugin-v0.1.2.tgz` — `npm pack` of the plugin (contents gated
  by the `files` allowlist: `dist/`, `assets/`, `skills/`,
  `openclaw.plugin.json`)
- `openclaw-fleet-linux-x86_64-v0.1.2` — release binary
- `SHA256SUMS.txt` — sha256 of every artifact

Verify with:

```bash
cd release/v0.1.2 && sha256sum -c SHA256SUMS.txt
```

Inspect tarball contents before shipping with `tar -tzf <tgz>` or
`npm pack --dry-run`.

## Security posture notes

- MIT license consistent across repo root, `plugin/package.json`,
  `plugin/LICENSE`, and `binary/Cargo.toml`.
- No secrets or machine-specific editor configuration in the release tree;
  `.vscode/` is ignored.
- SSH-only probing uses key auth (`id_ed25519`/`id_rsa`/`id_ecdsa`) and requires
  a matching `known_hosts` entry. Unknown and changed server keys fail closed.
- Dashboard and status routes use OpenClaw's `auth: "gateway"` HTTP boundary.
  Older route APIs are rejected instead of falling back to an unprotected path.
- Dashboard node interaction uses DOM event listeners rather than inline
  JavaScript, so machine-controlled names cannot cross into executable code.
- The plugin registers read-only tools; no arbitrary exec surface.
- Dashboard HTML loads fonts from Google Fonts CDN (no scripts); it degrades to
  system fonts offline. Only local data leaves nothing.
- npm installs run with lifecycle scripts disabled by the host
  (`--ignore-scripts`); this package has no install scripts and zero runtime
  dependencies.

## Distribution follow-up

The GitHub release is the canonical v0.1.2 distribution. ClawHub/npm packaging
can follow once the source-first installation has received field testing.
