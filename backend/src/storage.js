import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openStorage(path) {
  if (path !== ':memory:') {
    path = resolve(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
  }
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA trusted_schema = OFF;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (![0, 1, 2, 3].includes(version)) throw new Error('UNSUPPORTED_DATABASE_VERSION');
    if (version === 0) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin','director','user')),
          disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
          created_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          revoked_at INTEGER
        ) STRICT;
        CREATE INDEX sessions_user ON sessions(user_id);
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        CREATE TABLE signup_invitations (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          issuer_id TEXT NOT NULL REFERENCES users(id),
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER,
          revoked_at INTEGER
        ) STRICT;
        CREATE INDEX invitations_issuer ON signup_invitations(issuer_id);
        CREATE TABLE role_labels (
          role TEXT PRIMARY KEY CHECK (role IN ('admin','director','user')),
          label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40)
        ) STRICT;
        INSERT INTO role_labels VALUES ('admin','Administrador'),('director','Máster'),('user','Usuario');
        PRAGMA user_version = 1;
        COMMIT;`);
    }
    if (version < 2) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE rooms (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL REFERENCES users(id),
          name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
          created_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE room_codes (
          code_hash TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(id),
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          revoked_at INTEGER
        ) STRICT;
        CREATE UNIQUE INDEX room_active_code ON room_codes(room_id) WHERE revoked_at IS NULL;
        CREATE TABLE room_memberships (
          room_id TEXT NOT NULL REFERENCES rooms(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          active INTEGER NOT NULL CHECK(active IN (0,1)),
          dice_allowed INTEGER NOT NULL DEFAULT 0 CHECK(dice_allowed IN (0,1)),
          move_assigned_tokens INTEGER NOT NULL DEFAULT 0 CHECK(move_assigned_tokens IN (0,1)),
          joined_at INTEGER NOT NULL,
          PRIMARY KEY(room_id,user_id)
        ) STRICT;
        CREATE TABLE room_invitations (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(id),
          target_id TEXT NOT NULL REFERENCES users(id),
          issuer_id TEXT NOT NULL REFERENCES users(id),
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          used_at INTEGER,
          revoked_at INTEGER,
          dice_allowed INTEGER NOT NULL DEFAULT 0 CHECK(dice_allowed IN (0,1)),
          move_assigned_tokens INTEGER NOT NULL DEFAULT 0 CHECK(move_assigned_tokens IN (0,1))
        ) STRICT;
        CREATE UNIQUE INDEX room_pending_invitation ON room_invitations(room_id,target_id)
          WHERE used_at IS NULL AND revoked_at IS NULL;
        PRAGMA user_version = 2;
        COMMIT;`);
    }
    if (version < 3) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE room_authority (
          room_id TEXT PRIMARY KEY REFERENCES rooms(id),
          state_id TEXT NOT NULL,
          public_key TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision >= 0),
          state_digest TEXT NOT NULL CHECK(length(state_digest) = 64)
        ) STRICT;
        CREATE TABLE token_assignments (
          room_id TEXT NOT NULL REFERENCES rooms(id),
          token_id TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id),
          PRIMARY KEY(room_id,token_id,user_id)
        ) STRICT;
        PRAGMA user_version = 3;
        COMMIT;`);
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    db,
    transaction(work) {
      db.exec('BEGIN IMMEDIATE');
      try { const value = work(); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); }
  };
}
