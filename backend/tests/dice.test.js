import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackend } from '../src/server.js';
import { parseDice, DIE_SIDES } from '../shared/dice.js';
import { roomFixture } from './room-helpers.js';
import { connect, rawSocket, prove, send, waitFor } from './token-helpers.js';

test('strict dice parser supports all basic dice, counts and signed modifiers without code evaluation', () => {
  for (const sides of DIE_SIDES) assert.deepEqual(parseDice(`50d${sides}-1000`),{count:50,sides,modifier:-1000});
  assert.deepEqual(parseDice('2d6+3'),{count:2,sides:6,modifier:3});
  for (const text of ['0d6','51d6','1d7','1d1000','2d6+1001','2d6-1001','01d6','1d6+03','1d6;alert(1)','1d6\n','1D6',' 1d6','1d6+1+2',{},null,'x'.repeat(1000)]) assert.throws(()=>parseDice(text));
});

test('one server-generated roll reaches every authorized peer identically and survives reconnection', async t => {
  const f=await roomFixture(t,{EVENT_RATE_LIMIT:'100'}); f.admit(f.member,f.created,{diceAllowed:true});
  const director=await connect(rawSocket(t,f,f.director)); await prove(director);
  const player=await connect(rawSocket(t,f,f.member)), seen=[[],[]];
  director.on('dice:result',v=>seen[0].push(v.roll)); player.on('dice:result',v=>seen[1].push(v.roll));
  const input={eventId:randomUUID(),issuedAt:Date.now(),notation:'2d6+3'};
  const result=await send(player,'dice:roll',input); assert.equal(result.ok,true);
  await waitFor(()=>seen.every(rows=>rows.length===1));
  assert.deepEqual(seen[0],seen[1]); assert.deepEqual(seen[0][0],result.roll);
  assert.equal(result.roll.results.length,2); assert.ok(result.roll.results.every(n=>Number.isInteger(n)&&n>=1&&n<=6));
  assert.equal(result.roll.total,result.roll.results.reduce((a,b)=>a+b,3));
  assert.equal(result.roll.author.id,f.member.user.id);
  assert.equal((await send(player,'dice:roll',input)).error.code,'ROLL_REPLAYED');
  player.disconnect(); await connect(player);
  assert.deepEqual((await send(player,'dice:history:get')).rolls,[result.roll]);
  const other=f.rooms.create(f.director.token,{name:'Other room'});
  const isolated=await connect(rawSocket(t,f,f.director,other.room.id));
  assert.deepEqual((await send(isolated,'dice:history:get')).rolls,[]);
  f.rooms.updateMember(f.director.token,f.created.room.id,f.member.user.id,{permissions:{diceAllowed:false}});
  assert.equal((await send(player,'dice:roll',{...input,eventId:randomUUID()})).error.code,'FORBIDDEN');
});

test('server rejects forged results, unsupported event names, stale requests and excessive rate', async t => {
  const f=await roomFixture(t,{EVENT_RATE_LIMIT:'100'}); f.admit(f.member,f.created,{diceAllowed:true});
  const director=await connect(rawSocket(t,f,f.director)); await prove(director);
  const player=await connect(rawSocket(t,f,f.member));
  const input=()=>({eventId:randomUUID(),issuedAt:Date.now(),notation:'1d20'});
  assert.equal((await send(player,'dice:result',{roll:{total:20}})).error.code,'EVENT_NOT_AVAILABLE');
  assert.equal((await send(player,'dice:roll',{...input(),results:[20]})).error.code,'INVALID_MESSAGE');
  assert.equal((await send(player,'dice:roll',{...input(),issuedAt:Date.now()-61000})).error.code,'STALE_ROLL');
  for (const sides of DIE_SIDES.slice(0,6)) {
    const result=await send(director,'dice:roll',{...input(),notation:`1d${sides}`});
    assert.equal(result.ok,true); assert.ok(result.roll.results[0]>=1 && result.roll.results[0]<=sides);
  }
  assert.equal((await send(director,'dice:roll',input())).error.code,'DICE_RATE_LIMITED');
});

test('bounded recent history retains 50 results and permits d100 after the rate window', async t => {
  let now=Date.now(); const f=await roomFixture(t,{EVENT_RATE_LIMIT:'1000'},{clock:()=>now});
  const director=await connect(rawSocket(t,f,f.director)); await prove(director);
  for (let i=0;i<80;i++) {
    now+=10001;
    const result=await send(director,'dice:roll',{eventId:randomUUID(),issuedAt:now,notation:'1d100-2'});
    assert.equal(result.ok,true); assert.ok(result.roll.results[0]>=1&&result.roll.results[0]<=100);
  }
  assert.equal((await send(director,'dice:history:get')).rolls.length,50);
  assert.ok(f.app.store.db.prepare('SELECT count(*) AS n FROM dice_rolls').get().n<=51);
});

test('SQLite history survives backend restart without retaining credentials',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'phase10-dice-')),cleanups=[];
  t.after(async()=>{for(const cleanup of cleanups.reverse())await cleanup();await rm(dir,{recursive:true,force:true});});
  const scoped={after:fn=>cleanups.push(fn)};
  const f=await roomFixture(scoped,{DATABASE_PATH:join(dir,'game.sqlite')});
  const director=await connect(rawSocket(scoped,f,f.director)); await prove(director);
  const result=await send(director,'dice:roll',{eventId:randomUUID(),issuedAt:Date.now(),notation:'2d6+3'});
  await f.app.close();
  const app=createBackend(f.config);cleanups.push(()=>app.close()); const address=await app.listen(0);
  const restored=await connect(rawSocket(scoped,{...f,app,url:`http://127.0.0.1:${address.port}`},f.director));
  assert.deepEqual((await send(restored,'dice:history:get')).rolls,[result.roll]);
});
