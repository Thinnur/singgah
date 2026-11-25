import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { labAccountsFile } from '../sshstore.ts';

const LAB_ID = /^lab-[a-z0-9]{1,20}$/;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Writes <dir>/<lab-id>/accounts for every lab, atomically and only when the content changed.
 * The lab container mounts <dir>/<lab-id> read-only and syncs its Linux users from this file.
 * Modes are set explicitly (umask 0027 would strip them); secrecy comes from /var/lib/singgah (0750).
 */
export function syncAccountFiles(db: DatabaseSync, dir: string): { written: string[]; errors: string[] } {
  const res = { written: [] as string[], errors: [] as string[] };
  for (const { id } of db.prepare('SELECT id FROM labs ORDER BY id').all() as { id: string }[]) {
    // labs.id CHECK only looks at its first character; a tampered id must not escape dir
    if (!LAB_ID.test(id)) { res.errors.push(`lab ${JSON.stringify(id)}: id tidak valid, dilewati`); continue; }
    try {
      const content = labAccountsFile(db, id);
      const labDir = join(dir, id);
      const file = join(labDir, 'accounts');
      let current: string | null = null;
      try { current = readFileSync(file, 'utf8'); } catch { /* not written yet */ }
      if (current === content) continue;
      mkdirSync(labDir, { recursive: true });
      chmodSync(labDir, 0o755);
      writeFileSync(`${file}.tmp`, content);
      chmodSync(`${file}.tmp`, 0o644);
      renameSync(`${file}.tmp`, file);
      res.written.push(id);
    } catch (e) {
      res.errors.push(`lab ${id}: ${msg(e)}`);
    }
  }
  return res;
}
