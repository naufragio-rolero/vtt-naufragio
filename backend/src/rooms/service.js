import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpError } from '../errors.js';
import { fields, id } from '../auth/validation.js';
import { requirePermission } from '../auth/permissions.js';
import { createLimiter } from '../limits.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const roomData = row => ({ id: row.id, ownerId: row.owner_id, name: row.name, createdAt: row.created_at });
const permissions = row => ({ diceAllowed: Boolean(row.dice_allowed), moveAssignedTokens: Boolean(row.move_assigned_tokens) });
function parsePermissions(value = {}, base = { diceAllowed: false, moveAssignedTokens: false }) {
  fields(value, [], ['diceAllowed', 'moveAssignedTokens']);
  if (Object.values(value).some(flag => typeof flag !== 'boolean')) throw new HttpError(400, 'INVALID_INPUT');
  return { ...base, ...value };
}

export function createRoomService(store, auth, config, { clock = Date.now,
  generateCode = () => `room_${randomBytes(16).toString('base64url')}` } = {}) {
  const { db } = store;
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const acceptJoin = createLimiter(config.roomJoinRateLimit, config.authWindowMs, { clock });
  const denied = () => { throw new HttpError(404, 'ROOM_ACCESS_DENIED'); };
  function owner(token, roomId) {
    const actor = auth.session(token);
    requirePermission(actor, 'rooms:create');
    id(roomId);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND owner_id = ?').get(roomId, actor.id);
    if (!room) denied();
    return { actor, room };
  }
  function access(token, roomId) {
    const actor = auth.session(token);
    id(roomId);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    const member = db.prepare('SELECT * FROM room_memberships WHERE room_id = ? AND user_id = ? AND active = 1').get(roomId, actor.id);
    if (!room || !member || (room.owner_id === actor.id && actor.role !== 'director')) denied();
    return { actor, room: roomData(room), permissions: permissions(member), isOwner: room.owner_id === actor.id };
  }
  function issueCode(roomId) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      if (!/^room_[A-Za-z0-9_-]{22}$/.test(code)) throw new Error('INVALID_CODE_GENERATOR');
      const hash = digest(code);
      if (db.prepare('SELECT 1 FROM room_codes WHERE code_hash = ?').get(hash)) continue;
      const expiresAt = clock() + config.roomCodeTtlSeconds * 1000;
      db.prepare('INSERT INTO room_codes(code_hash,room_id,created_at,expires_at) VALUES (?,?,?,?)').run(hash, roomId, clock(), expiresAt);
      return { code, expiresAt };
    }
    throw new HttpError(503, 'CODE_CAPACITY');
  }
  return {
    access,
    onChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    create(token, input) {
      fields(input, ['name']);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80 || /[\u0000-\u001f\u007f]/.test(input.name)) {
        throw new HttpError(400, 'INVALID_INPUT');
      }
      return store.transaction(() => {
        const actor = auth.session(token);
        requirePermission(actor, 'rooms:create');
        if (db.prepare('SELECT count(*) AS n FROM rooms WHERE owner_id = ?').get(actor.id).n >= 100) throw new HttpError(429, 'ROOM_LIMIT');
        const roomId = randomUUID();
        db.prepare('INSERT INTO rooms VALUES (?,?,?,?)').run(roomId, actor.id, input.name.trim(), clock());
        db.prepare('INSERT INTO room_memberships(room_id,user_id,active,joined_at) VALUES (?,?,1,?)').run(roomId, actor.id, clock());
        return { room: roomData(db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId)), admissionCode: issueCode(roomId) };
      });
    },
    list(token) {
      const actor = auth.session(token);
      return db.prepare(`SELECT r.* FROM rooms r JOIN room_memberships m ON m.room_id=r.id
        WHERE m.user_id=? AND m.active=1 AND (r.owner_id<>? OR ?='director') ORDER BY r.created_at,r.id LIMIT 1000`)
        .all(actor.id, actor.id, actor.role).map(roomData);
    },
    get(token, roomId) {
      const result = access(token, roomId);
      return { room: result.room, permissions: result.permissions, isOwner: result.isOwner };
    },
    rotateCode(token, roomId) {
      return store.transaction(() => {
        owner(token, roomId);
        db.prepare('UPDATE room_codes SET revoked_at=? WHERE room_id=? AND revoked_at IS NULL').run(clock(), roomId);
        return issueCode(roomId);
      });
    },
    revokeCode(token, roomId) {
      owner(token, roomId);
      db.prepare('UPDATE room_codes SET revoked_at=? WHERE room_id=? AND revoked_at IS NULL').run(clock(), roomId);
    },
    invite(token, roomId, input) {
      fields(input, ['userId'], ['permissions', 'expiresInSeconds']);
      id(input.userId);
      const flags = parsePermissions(input.permissions);
      const duration = input.expiresInSeconds ?? config.roomInvitationTtlSeconds;
      if (!Number.isInteger(duration) || duration < 60 || duration > config.roomInvitationTtlSeconds) throw new HttpError(400, 'INVALID_INPUT');
      return store.transaction(() => {
        const { actor } = owner(token, roomId);
        if (!db.prepare('SELECT id FROM users WHERE id=? AND disabled=0').get(input.userId)) throw new HttpError(404, 'USER_NOT_FOUND');
        if (db.prepare('SELECT 1 FROM room_memberships WHERE room_id=? AND user_id=? AND active=1').get(roomId, input.userId)) {
          throw new HttpError(409, 'ALREADY_MEMBER');
        }
        if (db.prepare('SELECT count(*) AS n FROM room_invitations WHERE room_id=? AND target_id<>? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(roomId, input.userId, clock()).n >= 100) {
          throw new HttpError(429, 'ROOM_INVITATION_LIMIT');
        }
        db.prepare('UPDATE room_invitations SET revoked_at=? WHERE room_id=? AND target_id=? AND used_at IS NULL AND revoked_at IS NULL').run(clock(), roomId, input.userId);
        const invitationId = randomUUID();
        const expiresAt = clock() + duration * 1000;
        db.prepare(`INSERT INTO room_invitations(id,room_id,target_id,issuer_id,created_at,expires_at,dice_allowed,move_assigned_tokens)
          VALUES (?,?,?,?,?,?,?,?)`).run(invitationId, roomId, input.userId, actor.id, clock(), expiresAt, Number(flags.diceAllowed), Number(flags.moveAssignedTokens));
        return { id: invitationId, kind: 'room_membership', roomId, userId: input.userId, expiresAt, permissions: flags };
      });
    },
    invitations(token) {
      const actor = auth.session(token);
      return db.prepare(`SELECT i.*,r.name FROM room_invitations i JOIN rooms r ON r.id=i.room_id
        JOIN users u ON u.id=r.owner_id WHERE i.target_id=? AND i.used_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at>? AND u.disabled=0 AND u.role='director' ORDER BY i.created_at LIMIT 1000`).all(actor.id, clock())
        .map(row => ({ id: row.id, kind: 'room_membership', roomId: row.room_id, name: row.name, expiresAt: row.expires_at, permissions: permissions(row) }));
    },
    revokeInvitation(token, roomId, invitationId) {
      owner(token, roomId);
      id(invitationId);
      if (!db.prepare('UPDATE room_invitations SET revoked_at=? WHERE id=? AND room_id=?').run(clock(), invitationId, roomId).changes) {
        throw new HttpError(404, 'ROOM_INVITATION_NOT_FOUND');
      }
    },
    join(token, input) {
      const actor = auth.session(token);
      if (!acceptJoin(actor.id)) throw new HttpError(429, 'ROOM_JOIN_RATE_LIMITED');
      fields(input, ['code']);
      if (typeof input.code !== 'string' || !/^room_[A-Za-z0-9_-]{22}$/.test(input.code)) denied();
      const result = store.transaction(() => {
        const current = auth.session(token);
        const code = db.prepare(`SELECT c.room_id FROM room_codes c JOIN rooms r ON r.id=c.room_id JOIN users u ON u.id=r.owner_id
          WHERE c.code_hash=? AND c.expires_at>? AND c.revoked_at IS NULL AND u.disabled=0 AND u.role='director'`).get(digest(input.code), clock());
        if (!code) denied();
        const existing = db.prepare('SELECT active FROM room_memberships WHERE room_id=? AND user_id=?').get(code.room_id, current.id);
        if (!existing?.active) {
          const invitation = db.prepare(`SELECT * FROM room_invitations WHERE room_id=? AND target_id=?
            AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?`).get(code.room_id, current.id, clock());
          if (!invitation) denied();
          db.prepare(`INSERT INTO room_memberships(room_id,user_id,active,dice_allowed,move_assigned_tokens,joined_at) VALUES (?,?,1,?,?,?)
            ON CONFLICT(room_id,user_id) DO UPDATE SET active=1,dice_allowed=excluded.dice_allowed,move_assigned_tokens=excluded.move_assigned_tokens,joined_at=excluded.joined_at`)
            .run(code.room_id, current.id, invitation.dice_allowed, invitation.move_assigned_tokens, clock());
          db.prepare('UPDATE room_invitations SET used_at=? WHERE id=?').run(clock(), invitation.id);
        }
        return this.get(token, code.room_id);
      });
      notify();
      return result;
    },
    members(token, roomId) {
      owner(token, roomId);
      return db.prepare(`SELECT m.*,u.username FROM room_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.room_id=? AND m.active=1 ORDER BY u.username LIMIT 1000`).all(roomId)
        .map(row => ({ userId: row.user_id, username: row.username, permissions: permissions(row) }));
    },
    updateMember(token, roomId, userId, input) {
      id(userId);
      fields(input, ['permissions']);
      const result = store.transaction(() => {
        const { room } = owner(token, roomId);
        if (userId === room.owner_id) throw new HttpError(409, 'OWNER_IMMUTABLE');
        const member = db.prepare('SELECT * FROM room_memberships WHERE room_id=? AND user_id=? AND active=1').get(roomId, userId);
        if (!member) denied();
        const flags = parsePermissions(input.permissions, permissions(member));
        db.prepare('UPDATE room_memberships SET dice_allowed=?,move_assigned_tokens=? WHERE room_id=? AND user_id=?').run(Number(flags.diceAllowed), Number(flags.moveAssignedTokens), roomId, userId);
        return { userId, permissions: flags };
      });
      notify();
      return result;
    },
    revokeMember(token, roomId, userId) {
      id(userId);
      store.transaction(() => {
        const { room } = owner(token, roomId);
        if (userId === room.owner_id) throw new HttpError(409, 'OWNER_IMMUTABLE');
        if (!db.prepare('UPDATE room_memberships SET active=0,dice_allowed=0,move_assigned_tokens=0 WHERE room_id=? AND user_id=?').run(roomId, userId).changes) denied();
        db.prepare('UPDATE room_invitations SET revoked_at=? WHERE room_id=? AND target_id=? AND used_at IS NULL AND revoked_at IS NULL').run(clock(), roomId, userId);
      });
      notify();
    }
  };
}
