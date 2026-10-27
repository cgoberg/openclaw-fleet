// Split-brain guard (connectors program T4): standalone mode probes the
// LAN for an existing Leassh server advertising `_leassh._tcp` via mDNS.
// Zero dependencies: a raw UDP mDNS PTR query on 224.0.0.251:5353.

import * as dgram from "dgram";

const MDNS_GROUP = "224.0.0.251";
const MDNS_PORT = 5353;
const SERVICE = "_leassh._tcp.local";

function encodeName(name: string): Buffer {
  const parts = name.split(".").map(Buffer.from);
  const bufs: Buffer[] = [];
  for (const p of parts) bufs.push(Buffer.from([p.length]), p);
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

/** One PTR question for the Leassh service type. */
function ptrQuestion(): Buffer {
  const header = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const qname = encodeName(SERVICE);
  const tail = Buffer.from([0x00, 0x0c, 0x00, 0x01]); // PTR, IN
  return Buffer.concat([header, qname, tail]);
}

export interface DiscoveredServer {
  name: string;
  host: string;
  port: number;
  apiPort?: number;
}

/**
 * Probe for a Leassh server for up to `timeoutMs`. Resolves with the first
 * answer (name + decoded TXT api_port when present), or null if none.
 */
export function probeForLeasshServer(timeoutMs = 2000): Promise<DiscoveredServer | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;

    const finish = (result: DiscoveredServer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    socket.on("error", () => finish(null));

    socket.on("message", (msg) => {
      // Walk the answer section looking for PTR RNAME == our service and
      // A/AAAA/TXT we can use. Simplest reliable parse: scan for the
      // service label bytes; if present, treat as found. TXT api_port
      // extraction: look for the literal "api_port=" in the packet.
      if (!msg.includes(Buffer.from(SERVICE))) return;
      const txtIdx = msg.indexOf(Buffer.from("api_port="));
      let apiPort: number | undefined;
      if (txtIdx >= 0) {
        const rest = msg.slice(txtIdx + 9).toString("latin1");
        const m = /^\d+/.exec(rest);
        if (m) apiPort = parseInt(m[0], 10);
      }
      finish({
        name: SERVICE,
        host: "", // full resolution unnecessary for the warning; URL hint below
        port: apiPort ?? 8790,
        apiPort,
      });
    });

    socket.bind(() => {
      socket.setMulticastTTL(1);
      socket.send(ptrQuestion(), MDNS_PORT, MDNS_GROUP, (err) => {
        if (err) finish(null);
      });
    });
  });
}
