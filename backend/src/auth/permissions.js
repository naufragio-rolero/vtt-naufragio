import { HttpError } from '../errors.js';

// The context must come from future server-side room membership/assignment lookups,
// never from an HTTP payload or Socket.IO handshake. No room route uses it yet.
export function can(actor, action, context = {}) {
  if (!actor || actor.disabled || !['admin', 'director', 'user'].includes(actor.role)) return false;
  if (['users:create', 'users:update', 'roles:update', 'sessions:revoke'].includes(action)) return actor.role === 'admin';
  if (action === 'invitations:create') return ['admin', 'director'].includes(actor.role);
  if (action === 'rooms:create') return actor.role === 'director';
  if (action === 'resources:upload') return actor.role === 'director';
  if (action === 'rooms:join') return context.member === true;
  const directs = actor.role === 'director' && context.ownerId === actor.id;
  if (['maps:activate', 'resources:edit', 'content:export', 'content:import', 'permissions:grant'].includes(action)) return directs;
  if (action === 'tokens:move') return context.member === true && context.directorOnline === true &&
    (directs || (context.tokenId !== undefined && context.assignedTokenIds instanceof Set && context.assignedTokenIds.has(context.tokenId)));
  if (action === 'dice:roll') return context.member === true && context.directorOnline === true && (directs || context.diceAllowed === true);
  return false;
}

export function requirePermission(actor, action, context) {
  if (!can(actor, action, context)) throw new HttpError(403, 'FORBIDDEN');
}
