const T = 'ip s5gw';

export const labSetName = (labId: string): string => labId.replace(/^lab-/, 'lab_');

/** Lab ids whose accept rule already exists in the forward chain, from `nft -j list table ip s5gw`. */
export function labsWithRule(nftJson: string): Set<string> {
  const items = (JSON.parse(nftJson) as { nftables: { rule?: { chain?: string; comment?: string } }[] }).nftables;
  return new Set(items.flatMap(({ rule }) =>
    rule?.chain === 'forward' && rule.comment?.startsWith('singgah:') ? [rule.comment.slice('singgah:'.length)] : []));
}

/** One nft script (applied atomically, one transaction) that makes every lab's set hold exactly `desired` IPs. */
export function buildNftScript(labs: { id: string; target_cidr: string }[], desired: Map<string, string[]>, haveRule: Set<string>): string {
  return labs.flatMap(({ id, target_cidr }) => {
    const set = labSetName(id);
    const ips = desired.get(id) ?? [];
    return [
      `add set ${T} ${set} { type ipv4_addr; }`,
      `flush set ${T} ${set}`,
      ...(ips.length ? [`add element ${T} ${set} { ${ips.join(', ')} }`] : []),
      // insert = top of the chain, ahead of the base drop rule from s5-labs
      ...(haveRule.has(id) ? [] : [`insert rule ${T} forward iifname "wg0" ip saddr @${set} ip daddr ${target_cidr} accept comment "singgah:${id}"`]),
    ];
  }).join('\n') + '\n';
}
