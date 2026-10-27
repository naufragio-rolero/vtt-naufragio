import { HttpError } from '../errors.js';
import { createLimiter } from '../limits.js';
import { requirePermission } from './permissions.js';
import { fields } from './validation.js';

function bearer(request) {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !/^Bearer sess_[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401, 'UNAUTHENTICATED');
  return value.slice(7);
}

export function createAuthRouter(auth, config, { clock = Date.now, rooms } = {}) {
  const attempt = createLimiter(config.authRateLimit, config.authWindowMs, { clock });
  const joinAttempt = createLimiter(config.roomJoinRateLimit, config.authWindowMs, { clock });
  const routes = [
    ['POST', /^\/auth\/login$/, { public: true, costly: true }, ({ body }) => auth.login(body)],
    ['GET', /^\/auth\/me$/, {}, ({ token }) => ({ user: auth.session(token) })],
    ['POST', /^\/auth\/logout$/, { empty: true }, ({ token }) => auth.logout(token)],
    ['POST', /^\/auth\/logout-all$/, { empty: true }, ({ token }) => auth.logout(token, true)],
    ['POST', /^\/auth\/password$/, { costly: true }, ({ token, body }) => auth.changePassword(token, body)],
    ['POST', /^\/auth\/register$/, { public: true, costly: true, status: 201 }, async ({ body }) => ({ user: await auth.register(body) })],
    ['POST', /^\/auth\/invitations\/validate$/, { public: true, costly: true }, ({ body }) => auth.validateInvitation(body)],
    ['GET', /^\/users$/, { permission: 'users:update' }, ({ token }) => ({ users: auth.listUsers(token) })],
    ['POST', /^\/users$/, { permission: 'users:create', costly: true, status: 201 }, async ({ token, body }) => ({ user: await auth.createUser(token, body) })],
    ['PATCH', /^\/users\/([^/]+)$/, { permission: 'users:update' }, ({ token, match, body }) => ({ user: auth.updateUser(token, match[1], body) })],
    ['POST', /^\/users\/([^/]+)\/revoke-sessions$/, { permission: 'sessions:revoke', empty: true }, ({ token, match }) => auth.revokeUserSessions(token, match[1])],
    ['GET', /^\/invitations$/, { permission: 'invitations:create' }, ({ token }) => ({ invitations: auth.listInvitations(token) })],
    ['POST', /^\/invitations$/, { permission: 'invitations:create', status: 201 }, ({ token, body }) => ({ invitation: auth.createInvitation(token, body) })],
    ['POST', /^\/invitations\/([^/]+)\/revoke$/, { permission: 'invitations:create', empty: true }, ({ token, match }) => auth.revokeInvitation(token, match[1])],
    ['GET', /^\/roles$/, { public: true }, () => ({ roleLabels: auth.roleLabels() })],
    ['PUT', /^\/roles$/, { permission: 'roles:update' }, ({ token, body }) => ({ roleLabels: auth.setRoleLabels(token, body) })],
    ['GET', /^\/rooms$/, {}, ({ token }) => ({ rooms: rooms.list(token) })],
    ['POST', /^\/rooms$/, { permission: 'rooms:create', status: 201 }, ({ token, body }) => rooms.create(token, body)],
    ['POST', /^\/rooms\/join$/, { roomAttempt: true }, ({ token, body }) => rooms.join(token, body)],
    ['GET', /^\/room-invitations$/, {}, ({ token }) => ({ invitations: rooms.invitations(token) })],
    ['GET', /^\/rooms\/([0-9a-f-]{36})$/, {}, ({ token, match }) => rooms.get(token, match[1])],
    ['POST', /^\/rooms\/([0-9a-f-]{36})\/code\/rotate$/, { empty: true }, ({ token, match }) => ({ admissionCode: rooms.rotateCode(token, match[1]) })],
    ['POST', /^\/rooms\/([0-9a-f-]{36})\/code\/revoke$/, { empty: true }, ({ token, match }) => rooms.revokeCode(token, match[1])],
    ['POST', /^\/rooms\/([0-9a-f-]{36})\/invitations$/, { status: 201 }, ({ token, match, body }) => ({ invitation: rooms.invite(token, match[1], body) })],
    ['POST', /^\/rooms\/([0-9a-f-]{36})\/invitations\/([0-9a-f-]{36})\/revoke$/, { empty: true }, ({ token, match }) => rooms.revokeInvitation(token, match[1], match[2])],
    ['GET', /^\/rooms\/([0-9a-f-]{36})\/members$/, {}, ({ token, match }) => ({ members: rooms.members(token, match[1]) })],
    ['PATCH', /^\/rooms\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/, {}, ({ token, match, body }) => rooms.updateMember(token, match[1], match[2], body)],
    ['POST', /^\/rooms\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})\/revoke$/, { empty: true }, ({ token, match }) => rooms.revokeMember(token, match[1], match[2])],
    ['POST', /^\/resources$/, { permission: 'resources:upload' }, () => { throw new HttpError(501, 'FEATURE_NOT_AVAILABLE'); }]
  ];
  return {
    match(pathname) {
      const candidates = routes.filter(route => route[1].test(pathname));
      if (!candidates.length) return null;
      return {
        methods: candidates.map(route => route[0]).join(', '),
        async execute(request, readBody) {
          const [method, expression, options, handler] = candidates.find(route => route[0] === request.method);
          const token = options.public ? null : bearer(request);
          if (token) {
            const actor = auth.session(token);
            if (options.permission) requirePermission(actor, options.permission);
          }
          if (options.costly && !attempt(request.socket.remoteAddress)) throw new HttpError(429, 'AUTH_RATE_LIMITED');
          if (options.roomAttempt && !joinAttempt(request.socket.remoteAddress)) throw new HttpError(429, 'ROOM_JOIN_RATE_LIMITED');
          const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(request, config.maxBodyBytes) : null;
          if (options.empty) fields(body, []);
          const result = await handler({ token, body, match: expression.exec(pathname) });
          return { status: result === undefined ? 204 : (options.status ?? 200), body: result };
        }
      };
    }
  };
}
