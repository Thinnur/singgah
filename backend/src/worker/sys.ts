import { execFile } from 'node:child_process';

export type Sys = {
  wgDump(): Promise<string>;
  wgSetPeer(pub: string, ip: string): Promise<void>;
  wgRemovePeer(pub: string): Promise<void>;
  nftListJson(): Promise<string>;
  nftApply(script: string): Promise<void>;
};

// stdout is never put in the error: the wg dump's first line is the server private key.
function run(cmd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(' ')}: ${stderr.trim() || err.message}`));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

export function realSys(iface: string): Sys {
  return {
    wgDump: () => run('wg', ['show', iface, 'dump']),
    wgSetPeer: async (pub, ip) => { await run('wg', ['set', iface, 'peer', pub, 'allowed-ips', `${ip}/32`]); },
    wgRemovePeer: async (pub) => { await run('wg', ['set', iface, 'peer', pub, 'remove']); },
    nftListJson: () => run('nft', ['-j', 'list', 'table', 'ip', 's5gw']),
    nftApply: async (script) => { await run('nft', ['-f', '-'], script); },
  };
}
