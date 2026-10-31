import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpError } from '../errors.js';
import { fields, id } from '../auth/validation.js';
import { createLimiter } from '../limits.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const token = prefix => `${prefix}_${randomBytes(32).toString('base64url')}`;
const valid = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9_-]{43}$`).test(value);
const fail = () => { throw new HttpError(410, 'ADMISSION_EXPIRED'); };

export function createGuestService(store, auth, rooms, config, { clock = Date.now } = {}) {
  const { db } = store;
  const poll = createLimiter(30, 60000, { clock });
  function cleanup() {
    store.transaction(() => {
      db.prepare(`DELETE FROM guest_requests WHERE expires_at<=? OR admission_id IN
        (SELECT id FROM room_admissions WHERE revoked_at IS NOT NULL OR expires_at<=?)`).run(clock(), clock());
      db.prepare('DELETE FROM room_admissions WHERE (revoked_at IS NOT NULL OR expires_at<=?) AND id NOT IN (SELECT admission_id FROM guest_requests)').run(clock());
      const expired = db.prepare('SELECT user_id FROM guest_accounts WHERE expires_at<=? OR revoked_at IS NOT NULL').all(clock());
      for (const { user_id: userId } of expired) {
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM token_assignments WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM room_memberships WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM guest_accounts WHERE user_id=?').run(userId);
        db.prepare('DELETE FROM users WHERE id=?').run(userId);
      }
    });
  }
  function owner(session, roomId) {
    const access = rooms.access(session, roomId);
    if (!access.isOwner) throw new HttpError(403, 'FORBIDDEN');
    return access;
  }
  function admission(value) {
    if (!valid(value, 'qr')) fail();
    const row = db.prepare(`SELECT a.* FROM room_admissions a JOIN rooms r ON r.id=a.room_id JOIN users u ON u.id=r.owner_id
      WHERE a.token_hash=? AND a.revoked_at IS NULL AND a.expires_at>? AND a.open=1 AND u.role='director' AND u.disabled=0`).get(hash(value), clock());
    if (!row) fail();
    return row;
  }
  function requestRow(input) {
    fields(input, ['requestToken']);
    if (!valid(input.requestToken, 'request')) fail();
    const row = db.prepare(`SELECT q.*,a.room_id,a.expires_at AS admission_expires,a.open,a.revoked_at,u.disabled,u.role
      FROM guest_requests q JOIN room_admissions a ON a.id=q.admission_id JOIN rooms r ON r.id=a.room_id JOIN users u ON u.id=r.owner_id
      WHERE q.claim_hash=?`).get(hash(input.requestToken));
    if (!row || row.expires_at<=clock() || row.admission_expires<=clock() || !row.open || row.revoked_at!==null || row.disabled || row.role!=='director') fail();
    return row;
  }
  cleanup();
  return {
    cleanup,
    open(session, roomId, input) {
      fields(input, [], ['expiresInSeconds']); owner(session, roomId); cleanup();
      const duration = input.expiresInSeconds ?? config.guestQrTtlSeconds;
      if (!Number.isInteger(duration) || duration<60 || duration>config.guestQrTtlSeconds) throw new HttpError(400, 'INVALID_INPUT');
      return store.transaction(() => {
        owner(session, roomId);
        if (db.prepare('SELECT count(*) AS n FROM room_admissions').get().n>=1000) throw new HttpError(429, 'ADMISSION_LIMIT');
        db.prepare('UPDATE room_admissions SET revoked_at=? WHERE room_id=? AND revoked_at IS NULL').run(clock(), roomId);
        const value=token('qr'), admissionId=randomUUID(), expiresAt=clock()+duration*1000;
        db.prepare('INSERT INTO room_admissions VALUES (?,?,?,?,1,NULL)').run(admissionId, roomId, hash(value), expiresAt);
        return { admission: { id: admissionId, token: value, expiresAt, open: true } };
      });
    },
    configure(session, roomId, input) {
      fields(input, ['open'], ['revoke']);
      if (typeof input.open!=='boolean' || (input.revoke!==undefined && typeof input.revoke!=='boolean')) throw new HttpError(400, 'INVALID_INPUT');
      owner(session, roomId);
      db.prepare('UPDATE room_admissions SET open=?,revoked_at=CASE WHEN ? THEN ? ELSE revoked_at END WHERE room_id=? AND revoked_at IS NULL')
        .run(Number(input.open), Number(input.revoke===true), clock(), roomId);
      if (!input.open || input.revoke) db.prepare(`UPDATE guest_requests SET state='rejected' WHERE admission_id IN
        (SELECT id FROM room_admissions WHERE room_id=?) AND state IN ('pending','approved')`).run(roomId);
      return { open: input.open && !input.revoke };
    },
    request(input) {
      fields(input, ['admissionToken','displayName']);
      if (typeof input.displayName!=='string' || !input.displayName.trim() || input.displayName.trim().length>40 ||
          /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(input.displayName)) throw new HttpError(400, 'INVALID_INPUT');
      cleanup();
      return store.transaction(() => {
        const a=admission(input.admissionToken);
        const count=db.prepare("SELECT count(*) AS n FROM guest_requests WHERE admission_id=? AND state IN ('pending','approved')").get(a.id).n;
        if (count>=config.guestLimit || db.prepare('SELECT count(*) AS n FROM guest_requests').get().n>=1000) throw new HttpError(429, 'ADMISSION_LIMIT');
        const value=token('request'), requestId=randomUUID(), expiresAt=Math.min(a.expires_at,clock()+config.guestRequestTtlSeconds*1000);
        db.prepare("INSERT INTO guest_requests VALUES (?,?,?,?,?,'pending',NULL)").run(requestId,a.id,hash(value),input.displayName.trim(),expiresAt);
        return { requestToken:value,expiresAt,state:'pending' };
      });
    },
    status(input) {
      cleanup(); const row=requestRow(input);
      if (!poll(row.id)) throw new HttpError(429, 'RATE_LIMITED');
      return { state:row.state,expiresAt:row.expires_at };
    },
    list(session,roomId) {
      owner(session,roomId);cleanup();
      const a=db.prepare('SELECT id,expires_at AS expiresAt,open FROM room_admissions WHERE room_id=? AND revoked_at IS NULL').get(roomId);
      return { admission:a ? {...a,open:Boolean(a.open)} : null,requests:db.prepare(`SELECT q.id,q.display_name AS displayName,q.state,q.expires_at AS expiresAt
        FROM guest_requests q JOIN room_admissions a ON a.id=q.admission_id WHERE a.room_id=? AND q.expires_at>? ORDER BY q.rowid LIMIT 1000`).all(roomId,clock()) };
    },
    decide(session,roomId,requestId,input) {
      id(requestId);fields(input,['approve']);if(typeof input.approve!=='boolean') throw new HttpError(400,'INVALID_INPUT');
      owner(session,roomId);cleanup();
      const row=db.prepare(`SELECT q.* FROM guest_requests q JOIN room_admissions a ON a.id=q.admission_id
        WHERE q.id=? AND a.room_id=? AND a.open=1 AND a.revoked_at IS NULL AND a.expires_at>? AND q.expires_at>? AND q.state='pending'`).get(requestId,roomId,clock(),clock());
      if(!row) fail();
      db.prepare('UPDATE guest_requests SET state=? WHERE id=?').run(input.approve?'approved':'rejected',row.id);
      return { state:input.approve?'approved':'rejected' };
    },
    claim(input) {
      cleanup();
      const result=store.transaction(() => {
        const q=requestRow(input);
        if(q.state!=='approved') throw new HttpError(403,'ADMISSION_NOT_APPROVED');
        if(db.prepare('SELECT count(*) AS n FROM guest_accounts WHERE room_id=? AND expires_at>? AND revoked_at IS NULL').get(q.room_id,clock()).n>=config.guestLimit ||
            db.prepare('SELECT count(*) AS n FROM guest_accounts').get().n>=1000) throw new HttpError(429,'ADMISSION_LIMIT');
        const userId=randomUUID(),expiresAt=clock()+config.guestSessionTtlSeconds*1000;
        db.prepare("INSERT INTO users(id,username,password_hash,role,created_at) VALUES (?,?,'!guest-no-password','user',?)").run(userId,'g_'+userId.replaceAll('-','').slice(0,30),clock());
        db.prepare('INSERT INTO guest_accounts VALUES (?,?,?,?,NULL)').run(userId,q.room_id,q.display_name,expiresAt);
        db.prepare('INSERT INTO room_memberships(room_id,user_id,active,joined_at) VALUES (?,?,1,?)').run(q.room_id,userId,clock());
        db.prepare("UPDATE guest_requests SET state='claimed',user_id=? WHERE id=?").run(userId,q.id);
        const session=auth.guestSession(userId,expiresAt);
        return {...session,selected:rooms.get(session.token,q.room_id)};
      });
      rooms.changed();return result;
    }
  };
}
