import os from "node:os";

function isIpv4(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

/** Non-loopback IPv4 addresses for LAN join hints. */
export function listLanIpv4(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const ifaces of Object.values(nets)) {
    for (const net of ifaces ?? []) {
      if (isIpv4(net.family) && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return [...new Set(ips)];
}
