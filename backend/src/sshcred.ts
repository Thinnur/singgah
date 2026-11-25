import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';

export const SSH_USERNAME = /^[a-z][a-z0-9]{0,31}$/;
export const SHA512_CRYPT = /^\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$/;

/** Names a student account must never get: Debian base users and groups (groupadd would fail forever) + our own. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'root', 'daemon', 'bin', 'sys', 'sync', 'games', 'man', 'lp', 'mail', 'news', 'uucp', 'proxy', 'backup', 'list',
  'irc', 'nobody', 'sshd', 'messagebus', 'systemd', 'admin', 'administrator', 'ubuntu', 'debian', 'singgah',
  'operator', 'guest', 'test',
  'adm', 'tty', 'disk', 'kmem', 'dialout', 'fax', 'voice', 'cdrom', 'floppy', 'tape', 'sudo', 'audio', 'dip', 'src',
  'shadow', 'utmp', 'video', 'sasl', 'plugdev', 'staff', 'users', 'nogroup', 'input', 'sgx', 'kvm', 'render', 'crontab',
]);

/** Local part of the email -> Linux username; isTaken checks names already given to other users. */
export function sshUsernameFor(email: string, isTaken: (name: string) => boolean): string {
  let local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (local === '') local = 'user';
  if (/^[0-9]/.test(local)) local = `u${local}`;
  const base = local.slice(0, 28); // room for a numeric suffix within 32
  let name = base;
  for (let n = 2; RESERVED_USERNAMES.has(name) || isTaken(name); n++) name = `${base}${n}`;
  return name;
}

// 32 symbols without l/o/0/1: 16 characters = 80 bits
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export function generatePassword(): string {
  const c = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return c.match(/.{4}/g)!.join('-');
}

/** sha512-crypt via openssl; the password goes through stdin, never argv (argv is visible in ps). */
export function hashPassword(pw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('openssl', ['passwd', '-6', '-stdin'], { timeout: 5000 }, (err, stdout) => {
      const h = String(stdout).trim();
      if (err) reject(new Error(`openssl passwd gagal: ${err.message}`));
      else if (!SHA512_CRYPT.test(h)) reject(new Error('openssl passwd: hasil bukan sha512-crypt'));
      else resolve(h);
    });
    child.stdin!.end(pw);
  });
}
