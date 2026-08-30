# Security

Report vulnerabilities privately through GitHub's security-advisory flow for
this repository. Do not open a public issue containing SSH keys, host
fingerprints, fleet configuration, process lists, usernames, or identifiable
machine data.

OpenClaw Fleet is read-only at the command layer, but its observations are
sensitive. It can expose machine names, logged-in users, running processes,
resource use, and availability through the OpenClaw agent and dashboard.

## Required boundaries

- SSH server keys must match `~/.ssh/known_hosts`; unknown or changed keys fail
  closed. Verify fingerprints through a trusted channel before accepting them.
- Use a dedicated, unprivileged SSH account that can run only the documented
  probe commands. Do not monitor as `root`.
- Dashboard and status routes require OpenClaw gateway authentication. The
  plugin refuses to load on older hosts that cannot register authenticated HTTP
  routes.
- Keep `fleet.yaml`, SSH private keys, OpenClaw credentials, logs, and captured
  fleet output outside git.

Security fixes are applied to the latest release.
