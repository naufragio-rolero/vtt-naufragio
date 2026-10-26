import test from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/auth/permissions.js';

const admin = { id: 'a', role: 'admin', disabled: false };
const director = { id: 'd', role: 'director', disabled: false };
const user = { id: 'u', role: 'user', disabled: false };

test('global permissions deny by default and separate administration from direction', () => {
  for (const action of ['users:create', 'users:update', 'roles:update', 'sessions:revoke']) {
    assert.equal(can(admin, action), true);
    assert.equal(can(director, action), false);
    assert.equal(can(user, action), false);
  }
  assert.equal(can(director, 'invitations:create'), true);
  assert.equal(can(admin, 'invitations:create'), true);
  assert.equal(can(user, 'invitations:create'), false);
  for (const action of ['rooms:create', 'resources:upload']) {
    assert.equal(can(user, action), false);
    assert.equal(can(admin, action), false);
    assert.equal(can(director, action), true);
  }
  for (const actor of [null, user, director, admin, { ...admin, disabled: true }, { id: 'x', role: 'Administrador' }]) {
    assert.equal(can(actor, 'invented-permission'), false);
    assert.equal(can(actor, 'tokens:move'), false);
    assert.equal(can(actor, 'dice:roll'), false);
  }
});

test('future room policy requires membership, assignment and an online director', () => {
  const context = { member: true, directorOnline: true, ownerId: director.id, tokenId: 't1', assignedTokenIds: new Set(['t1']) };
  assert.equal(can(user, 'rooms:join'), false);
  assert.equal(can(user, 'rooms:join', context), true);
  assert.equal(can(user, 'tokens:move', context), true);
  for (const change of [{ member: false }, { directorOnline: false }, { tokenId: 'other' }, { assignedTokenIds: new Set() }]) {
    assert.equal(can(user, 'tokens:move', { ...context, ...change }), false);
  }
  assert.equal(can(user, 'dice:roll', context), false);
  assert.equal(can(user, 'dice:roll', { ...context, diceAllowed: true }), true);
  assert.equal(can(user, 'dice:roll', { ...context, diceAllowed: true, directorOnline: false }), false);
  assert.equal(can(director, 'maps:activate', context), true);
  assert.equal(can(director, 'maps:activate', { ...context, ownerId: 'other' }), false);
  assert.equal(can(user, 'permissions:grant', context), false);
  assert.equal(can(admin, 'maps:activate', context), false);
});
