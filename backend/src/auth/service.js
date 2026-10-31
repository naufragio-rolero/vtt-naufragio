import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpError } from '../errors.js';
import { createLimiter } from '../limits.js';
import { passwords, validateNewPassword } from './passwords.js';
import { fields, username, role, id, loginInput } from './validation.js';
import { requirePermission } from './permissions.js';

const digest = token => createHash('sha256').update(token).digest('hex');
const generate = prefix => `${prefix}_${randomBytes(32).toString('base64url')}`;
const validToken = (token, prefix) => typeof token === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`).test(token);
const publicUser = user => ({ id: user.id, username: user.guest_name ?? user.username, role: user.role, disabled: Boolean(user.disabled),
  ...(user.guest_room ? { guest: true, roomId: user.guest_room } : {}) });

export function createAuthService(store, config, { clock = Date.now, hasher = passwords, reportChangeError = () => {} } = {}) {
  const { db } = store;
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) { try { listener(); } catch { reportChangeError({ code: 'AUTH_REFRESH_FAILED' }); } } };
  const accountAttempt = createLimiter(config.authRateLimit, config.authWindowMs, { clock });
  const getUser = userId => db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  function sessionRow(token) {
    if (!validToken(token, 'sess')) throw new HttpError(401, 'UNAUTHENTICATED');
    const row = db.prepare(`SELECT u.*,s.expires_at AS session_expires,g.room_id AS guest_room,g.display_name AS guest_name
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN guest_accounts g ON g.user_id=u.id
      WHERE s.token_hash = ? AND s.expires_at > ? AND s.revoked_at IS NULL AND u.disabled = 0
      AND (g.user_id IS NULL OR (g.expires_at > ? AND g.revoked_at IS NULL AND u.role='user'
        AND EXISTS(SELECT 1 FROM room_memberships m WHERE m.room_id=g.room_id AND m.user_id=u.id AND m.active=1)))`).get(digest(token), clock(), clock());
    if (!row) throw new HttpError(401, 'UNAUTHENTICATED');
    return row;
  }
  const session = token => publicUser(sessionRow(token));
  function authorized(token, action) {
    const actor = session(token);
    requirePermission(actor, action);
    return actor;
  }
  function insertUser(name, hash, userRole) {
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(name)) throw new HttpError(409, 'USERNAME_UNAVAILABLE');
    const userId = randomUUID();
    db.prepare('INSERT INTO users(id, username, password_hash, role, created_at) VALUES (?,?,?,?,?)').run(userId, name, hash, userRole, clock());
    return publicUser(getUser(userId));
  }
  function revokeSessions(userId) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(clock(), userId);
  }
  function invitation(token) {
    if (!validToken(token, 'signup')) throw new HttpError(400, 'INVALID_INVITATION');
    const row = db.prepare(`SELECT i.* FROM signup_invitations i JOIN users u ON u.id = i.issuer_id
      WHERE i.token_hash = ? AND i.expires_at > ? AND i.used_at IS NULL AND i.revoked_at IS NULL
      AND u.disabled = 0 AND u.role IN ('admin','director')`).get(digest(token), clock());
    if (!row) throw new HttpError(400, 'INVALID_INVITATION');
    return row;
  }
  return {
    session,
    // Internal capability minting for an approved, room-scoped temporary identity; never exposed as an HTTP route.
    guestSession(userId, expiresAt) {
      if (!db.prepare('SELECT 1 FROM guest_accounts WHERE user_id=? AND expires_at=? AND revoked_at IS NULL').get(userId, expiresAt)) throw new HttpError(403, 'FORBIDDEN');
      const token = generate('sess');
      db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(digest(token), userId, clock(), expiresAt);
      return { token, expiresAt, user: session(token) };
    },
    sessionInfo(token) { const row = sessionRow(token); return { user: publicUser(row), expiresAt: row.session_expires }; },
    onChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    bootstrapAvailable() { return db.prepare('SELECT count(*) AS total FROM users').get().total === 0; },
    async bootstrap(input) {
      fields(input, ['username', 'password']);
      const name = username(input.username);
      if (!this.bootstrapAvailable()) throw new HttpError(409, 'ALREADY_INITIALIZED');
      const hash = await hasher.hash(input.password);
      return store.transaction(() => {
        if (!this.bootstrapAvailable()) throw new HttpError(409, 'ALREADY_INITIALIZED');
        return insertUser(name, hash, 'admin');
      });
    },
    async login(input) {
      const name = loginInput(input);
      if (!accountAttempt(digest(name))) throw new HttpError(429, 'AUTH_RATE_LIMITED');
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
      const matches = await hasher.verify(input.password, user?.password_hash);
      const created = store.transaction(() => {
        const current = user && getUser(user.id);
        if (!matches || !current || current.disabled || current.password_hash !== user.password_hash ||
            db.prepare('SELECT 1 FROM guest_accounts WHERE user_id=?').get(current.id)) {
          throw new HttpError(401, 'INVALID_CREDENTIALS');
        }
        const now = clock();
        db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(now);
        // Keep at most five active sessions per account, including the new one.
        db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
          (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, token_hash LIMIT 4)`).run(current.id, current.id);
        const token = generate('sess');
        const expiresAt = now + config.sessionTtlSeconds * 1000;
        db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(digest(token), current.id, now, expiresAt);
        return { token, expiresAt, user: publicUser(current) };
      });
      notify();
      return created;
    },
    logout(token, all = false) {
      const actor = session(token);
      if (all) revokeSessions(actor.id);
      else db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').run(clock(), digest(token));
      notify();
    },
    async changePassword(token, input) {
      fields(input, ['currentPassword', 'newPassword']);
      const actor = session(token);
      if (actor.guest) throw new HttpError(403, 'FORBIDDEN');
      loginInput({ username: actor.username, password: input.currentPassword });
      validateNewPassword(input.newPassword);
      const before = getUser(actor.id).password_hash;
      if (!await hasher.verify(input.currentPassword, before)) throw new HttpError(401, 'INVALID_CREDENTIALS');
      const hash = await hasher.hash(input.newPassword);
      store.transaction(() => {
        session(token);
        if (getUser(actor.id).password_hash !== before) throw new HttpError(401, 'UNAUTHENTICATED');
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, actor.id);
        revokeSessions(actor.id);
      });
      notify();
    },
    listUsers(token) {
      authorized(token, 'users:update');
      return db.prepare('SELECT id,username,role,disabled FROM users ORDER BY username LIMIT 1000').all().map(publicUser);
    },
    async createUser(token, input) {
      authorized(token, 'users:create');
      fields(input, ['username', 'password', 'role']);
      const name = username(input.username);
      const userRole = role(input.role);
      const hash = await hasher.hash(input.password);
      return store.transaction(() => { authorized(token, 'users:create'); return insertUser(name, hash, userRole); });
    },
    updateUser(token, userId, input) {
      id(userId);
      fields(input, [], ['role', 'disabled']);
      if (Object.keys(input).length === 0 || (input.disabled !== undefined && typeof input.disabled !== 'boolean')) throw new HttpError(400, 'INVALID_INPUT');
      if (input.role !== undefined) role(input.role);
      const updated = store.transaction(() => {
        authorized(token, 'users:update');
        const target = getUser(userId);
        if (!target) throw new HttpError(404, 'USER_NOT_FOUND');
        if (db.prepare('SELECT 1 FROM guest_accounts WHERE user_id=?').get(userId)) throw new HttpError(403, 'FORBIDDEN');
        const nextRole = input.role ?? target.role;
        const disabled = input.disabled === undefined ? target.disabled : Number(input.disabled);
        if (target.role === 'admin' && !target.disabled && (nextRole !== 'admin' || disabled) &&
            db.prepare("SELECT count(*) AS total FROM users WHERE role = 'admin' AND disabled = 0").get().total <= 1) {
          throw new HttpError(409, 'LAST_ADMIN');
        }
        db.prepare('UPDATE users SET role = ?, disabled = ? WHERE id = ?').run(nextRole, disabled, userId);
        revokeSessions(userId);
        db.prepare('UPDATE signup_invitations SET revoked_at = ? WHERE issuer_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(clock(), userId);
        db.prepare('UPDATE room_invitations SET revoked_at = ? WHERE (issuer_id=? OR target_id=?) AND used_at IS NULL AND revoked_at IS NULL').run(clock(), userId, userId);
        db.prepare('DELETE FROM token_assignments WHERE user_id=?').run(userId);
        return publicUser(getUser(userId));
      });
      notify();
      return updated;
    },
    revokeUserSessions(token, userId) {
      authorized(token, 'sessions:revoke');
      id(userId);
      if (!getUser(userId)) throw new HttpError(404, 'USER_NOT_FOUND');
      revokeSessions(userId);
      notify();
    },
    createInvitation(token, input) {
      fields(input, [], ['expiresInSeconds']);
      const duration = input.expiresInSeconds ?? config.invitationTtlSeconds;
      if (!Number.isInteger(duration) || duration < 60 || duration > config.invitationTtlSeconds) throw new HttpError(400, 'INVALID_INPUT');
      return store.transaction(() => {
        const actor = authorized(token, 'invitations:create');
        if (db.prepare('SELECT count(*) AS total FROM signup_invitations WHERE issuer_id = ? AND expires_at > ? AND used_at IS NULL AND revoked_at IS NULL').get(actor.id, clock()).total >= 50) {
          throw new HttpError(429, 'INVITATION_LIMIT');
        }
        const invitationId = randomUUID();
        const value = generate('signup');
        const expiresAt = clock() + duration * 1000;
        db.prepare('INSERT INTO signup_invitations(id,token_hash,issuer_id,created_at,expires_at) VALUES (?,?,?,?,?)').run(invitationId, digest(value), actor.id, clock(), expiresAt);
        return { id: invitationId, token: value, expiresAt, kind: 'account_signup', role: 'user' };
      });
    },
    listInvitations(token) {
      const actor = authorized(token, 'invitations:create');
      return db.prepare(`SELECT id,issuer_id AS issuerId,created_at AS createdAt,expires_at AS expiresAt,used_at AS usedAt,revoked_at AS revokedAt
        FROM signup_invitations WHERE ? = 'admin' OR issuer_id = ? ORDER BY created_at DESC LIMIT 1000`).all(actor.role, actor.id);
    },
    revokeInvitation(token, invitationId) {
      id(invitationId);
      const actor = authorized(token, 'invitations:create');
      const result = db.prepare(`UPDATE signup_invitations SET revoked_at = ? WHERE id = ? AND (? = 'admin' OR issuer_id = ?)`)
        .run(clock(), invitationId, actor.role, actor.id);
      if (!result.changes) throw new HttpError(404, 'INVITATION_NOT_FOUND');
    },
    validateInvitation(input) {
      fields(input, ['token']);
      const row = invitation(input.token);
      return { valid: true, kind: 'account_signup', role: 'user', expiresAt: row.expires_at };
    },
    async register(input) {
      fields(input, ['username', 'password', 'invitationToken']);
      const name = username(input.username);
      invitation(input.invitationToken);
      const hash = await hasher.hash(input.password);
      return store.transaction(() => {
        const row = invitation(input.invitationToken);
        const created = insertUser(name, hash, 'user');
        db.prepare('UPDATE signup_invitations SET used_at = ? WHERE id = ?').run(clock(), row.id);
        return created;
      });
    },
    roleLabels() { return Object.fromEntries(db.prepare('SELECT role,label FROM role_labels').all().map(row => [row.role, row.label])); },
    setRoleLabels(token, input) {
      fields(input, ['admin', 'director', 'user']);
      for (const value of Object.values(input)) {
        if (typeof value !== 'string' || !value.trim() || value.length > 40 || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, 'INVALID_INPUT');
      }
      return store.transaction(() => {
        authorized(token, 'roles:update');
        for (const [key, value] of Object.entries(input)) db.prepare('UPDATE role_labels SET label = ? WHERE role = ?').run(value, key);
        return this.roleLabels();
      });
    }
  };
}
