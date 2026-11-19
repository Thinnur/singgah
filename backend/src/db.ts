import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

export const SCHEMA_V1 = `
CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT CHECK(role IN ('student','admin')),
  created_at INTEGER,
  last_login_at INTEGER
);
CREATE TABLE labs(
  id TEXT PRIMARY KEY CHECK(id GLOB 'lab-[a-z0-9]*' AND length(id)<=24),
  name TEXT NOT NULL,
  target_cidr TEXT NOT NULL,
  max_hours INTEGER NOT NULL DEFAULT 4,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER
);
CREATE TABLE leases(
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  lab_id TEXT REFERENCES labs(id),
  tunnel_ip TEXT,
  client_pubkey TEXT UNIQUE,
  status TEXT CHECK(status IN ('ACTIVE','EXPIRED','REVOKED')),
  starts_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT,
  reason TEXT,
  requester_ip TEXT,
  installed_at INTEGER,
  ended_at INTEGER,
  bytes_rx INTEGER DEFAULT 0,
  bytes_tx INTEGER DEFAULT 0,
  wg_rx_seen INTEGER DEFAULT 0,
  wg_tx_seen INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX leases_one_active_per_user ON leases(user_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX leases_tunnel_ip_in_use ON leases(tunnel_ip) WHERE ended_at IS NULL;
CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY,
  lease_id INTEGER,
  action TEXT CHECK(action IN ('ISSUED','REVOKED','EXPIRED','CLOSED')),
  actor TEXT,
  at INTEGER,
  detail TEXT
);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT,'audit_log append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT,'audit_log append-only'); END;
CREATE TABLE sessions(
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  expires_at INTEGER
);
INSERT INTO labs(id,name,target_cidr,max_hours,is_active,created_at) VALUES
  ('lab-cloud','Lab Cloud Computing','192.168.10.0/24',4,1,0),
  ('lab-cyber','Lab Cyber Security','192.168.20.0/24',4,1,0),
  ('lab-jarkom','Lab Jaringan Komputer','192.168.30.0/24',4,1,0);
`;

// v2: SSH accounts in the lab containers (docs/superpowers/specs/2026-11-19-akun-ssh-lab-design.md)
const SCHEMA_V2 = `
ALTER TABLE users ADD COLUMN ssh_username TEXT;
CREATE UNIQUE INDEX users_ssh_username ON users(ssh_username) WHERE ssh_username IS NOT NULL;
CREATE TABLE ssh_accounts(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  lab_id TEXT NOT NULL REFERENCES labs(id),
  status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','REVOKED')),
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  reason TEXT,
  password_hash TEXT,
  password_set_at INTEGER
);
CREATE UNIQUE INDEX ssh_accounts_one_open ON ssh_accounts(user_id, lab_id) WHERE status IN ('PENDING','APPROVED');
CREATE TABLE ssh_audit(
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('REQUESTED','APPROVED','REJECTED','REVOKED','PASSWORD_SET')),
  actor TEXT NOT NULL,
  at INTEGER NOT NULL,
  detail TEXT NOT NULL
);
CREATE TRIGGER ssh_audit_no_update BEFORE UPDATE ON ssh_audit
  BEGIN SELECT RAISE(ABORT,'ssh_audit append-only'); END;
CREATE TRIGGER ssh_audit_no_delete BEFORE DELETE ON ssh_audit
  BEGIN SELECT RAISE(ABORT,'ssh_audit append-only'); END;
`;

const version = (db: DatabaseSync) => db.prepare('PRAGMA user_version').get()!.user_version as number;

export function migrate(db: DatabaseSync): void {
  if (version(db) >= SCHEMA_VERSION) return;
  // BEGIN IMMEDIATE so two racing processes don't both apply a version
  db.exec('BEGIN IMMEDIATE');
  try {
    const v = version(db);
    if (v < 1) db.exec(SCHEMA_V1);
    if (v < 2) db.exec(SCHEMA_V2);
    if (v < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function assertSchema(db: DatabaseSync): void {
  const v = version(db);
  if (v !== SCHEMA_VERSION) throw new Error(`Versi schema ${v}, diharapkan ${SCHEMA_VERSION}`);
}

export function openDb(path: string, opts?: { migrate?: boolean }): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  if (opts?.migrate !== false) migrate(db);
  return db;
}
