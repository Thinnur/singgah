import { execFile } from 'node:child_process';

export type Sys = {
  wgDump(): Promise<string>;
  wgSetPeer(pub: string, ip: string): Promise<void>;
  wgRemovePeer(pub: string): Promise<void>;
  nftListJson(): Promise<string>;
  nftApply(script: string): Promise<void>;
};

// stdout is never put in the error: the wg dump's first line is the server private key.
function run(cmd: string, args: string[], label = `${cmd} ${args.join(' ')}`): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${label}: ${stderr.trim() || err.message}`));
      else resolve(stdout);
    });
  });
}

export function realSys(iface: string): Sys {
  return {
    wgDump: () => run('wg', ['show', iface, 'dump']),
    wgSetPeer: async (pub, ip) => { await run('wg', ['set', iface, 'peer', pub, 'allowed-ips', `${ip}/32`]); },
    wgRemovePeer: async (pub) => { await run('wg', ['set', iface, 'peer', pub, 'remove']); },
    nftListJson: () => run('nft', ['-j', 'list', 'table', 'ip', 's5gw']),
    // whole script as one argv element = one atomic transaction; `nft -f -` rejects Node's
    // stdin pipe (a socketpair) with 'Not a regular file: "/dev/stdin"' on nft 1.0.9
    nftApply: async (script) => { await run('nft', [script], 'nft <skrip>'); },
  };
}
