import test from 'node:test';
import assert from 'node:assert/strict';
import { insideBounds, validateBounds } from '../shared/board-bounds.js';
import { roomFixture } from './room-helpers.js';
import { rawSocket, connect, prove, localAuthority, moveInput, send, assign, accept } from './token-helpers.js';

test('fractional and offset rectangles include the full visual token radius', () => {
  const b = validateBounds({x:-2.25,y:3.5,width:10.5,height:4.25});
  assert.equal(insideBounds({x:-2.41,y:3.34},1,b),true);
  assert.equal(insideBounds({x:-2.42,y:3.34},1,b),false);
  assert.equal(insideBounds({x:0,y:3.5},4,b),false);
  assert.equal(insideBounds({x:100000,y:-100000},4,null),true);
  for (const value of [{x:0,y:0,width:Infinity,height:1},{x:0,y:0,width:0,height:1},{x:0,y:0,width:1,height:1,extra:true}]) assert.throws(()=>validateBounds(value));
});

test('authoritative bounds reject direct wire movement, preserve versions, share state and can be disabled', async t => {
  const f=await roomFixture(t,{EVENT_RATE_LIMIT:'100'});
  f.admit(f.member,f.created,{moveAssignedTokens:true});
  const director=await connect(rawSocket(t,f,f.director)), owner=await prove(director,localAuthority());
  const token=owner.record.current.tokens[0];
  await assign(director,owner,token.id,[f.member.user.id]);
  const player=await connect(rawSocket(t,f,f.member));
  const bounds={x:-1.25,y:-1.25,width:3,height:3};
  assert.equal((await send(director,'scene:set',{epoch:owner.epoch,revision:0,mode:'custom',bounds})).ok,true);
  assert.deepEqual((await send(player,'scene:get')).scene.bounds,bounds);
  for (const point of [{x:-2,y:0},{x:100,y:0},{x:1.25,y:1.25}]) {
    const result=await send(player,'token:move:request',{...moveInput(owner,token),position:point});
    assert.equal(result.error.code,'OUTSIDE_BOARD');
  }
  const input={...moveInput(owner,token),position:{x:.5,y:.5}};
  assert.equal((await send(player,'token:move:request',input)).status,'pending');
  assert.equal((await accept(director,owner,input)).status,'committed');
  assert.equal((await send(director,'scene:set',{epoch:owner.epoch,revision:1,mode:'custom',bounds:{x:10,y:10,width:2,height:2}})).error.code,'TOKENS_OUTSIDE_BOARD');
  assert.equal((await send(director,'scene:set',{epoch:owner.epoch,revision:1,mode:'free',bounds:null})).ok,true);
  const next=owner.record.current.tokens[0];
  assert.equal((await send(player,'token:move:request',{...moveInput(owner,next),position:{x:100,y:100}})).status,'pending');
});

test('participant cannot change a room scene even with a forged owner epoch', async t => {
  const f=await roomFixture(t); f.admit(f.member);
  const director=await connect(rawSocket(t,f,f.director)),owner=await prove(director);
  const player=await connect(rawSocket(t,f,f.member));
  assert.equal((await send(player,'scene:set',{epoch:owner.epoch,revision:0,mode:'free',bounds:null})).error.code,'FORBIDDEN');
});
