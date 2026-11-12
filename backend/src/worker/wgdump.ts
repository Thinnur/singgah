export type WgPeer = { publicKey: string; allowedIps: string[]; rx: number; tx: number };

/** Parses `wg show <iface> dump`. Line 1 is the interface (holds the private key) and is skipped. */
export function parseWgDump(text: string): WgPeer[] {
  return text.split('\n').slice(1).filter(Boolean).map((line) => {
    const f = line.split('\t');
    return { publicKey: f[0], allowedIps: f[3] === '(none)' ? [] : f[3].split(','), rx: Number(f[5]), tx: Number(f[6]) };
  });
}
